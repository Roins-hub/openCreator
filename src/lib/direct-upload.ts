"use client";

import type { MediaRef } from "./types";

type JsonRequest = <T>(url: string, init?: RequestInit) => Promise<T>;

const json = (body: unknown): RequestInit =>
  ({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

/** PUT 到对象存储的限时地址;用 XHR 才能拿到上传进度 */
function putFile(url: string, file: File, onProgress?: (fraction: number) => void) {
  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    if (file.type) xhr.setRequestHeader("Content-Type", file.type);
    xhr.upload.onprogress = (event) => { if (event.lengthComputable) onProgress?.(event.loaded / event.total); };
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`上传失败（${xhr.status}）`)));
    xhr.onerror = () => reject(new Error("上传失败"));
    xhr.onabort = () => reject(new Error("上传已取消"));
    xhr.send(file);
  });
}

/**
 * 上传一个素材:优先由浏览器直传对象存储(不经过本站服务器,快得多),
 * 直传不可用(本地存储、跨域规则没配、网络被拦)时退回经本站服务器上传。
 */
export async function uploadMedia(file: File, request: JsonRequest, onProgress?: (fraction: number) => void) {
  const name = file.name || "upload";
  const type = file.type;
  const sign = await request<{ direct: boolean; path?: string; url?: string }>("/api/uploads/direct",
    json({ step: "sign", name, type, size: file.size }));
  if (sign.direct && sign.url && sign.path) {
    const sent = await putFile(sign.url, file, onProgress).then(() => true, () => false);
    if (sent) return request<MediaRef>("/api/uploads/direct", json({ step: "complete", name, type, path: sign.path }));
  }
  const form = new FormData();
  form.append("files", file);
  const [uploaded] = await request<MediaRef[]>("/api/uploads", { method: "POST", body: form });
  return uploaded;
}
