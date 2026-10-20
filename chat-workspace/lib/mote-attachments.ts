import { SimpleImageAttachmentAdapter } from "@assistant-ui/react";
import type { AttachmentAdapter, CompleteAttachment, PendingAttachment } from "@assistant-ui/react";
import type { UIMessage } from "ai";
import { moteHeaders } from "@/lib/mote";
import { officeText } from "@/lib/office-text";

/**
 * 工作台模式下的图片附件:上传到工作台的对象存储(和视频、图片素材同一个地方),
 * 聊天记录里只存图片地址,不再把整张图的 base64 存进记录,服务器上的记录不会越来越大。
 * 发给模型前再由浏览器取回图片转成 data URL(见 inlineMoteImages)。
 * 存储桶对 users/ 下的文件有过期规则(目前 60 天),和工作台的其他素材一致。
 */
const UPLOADABLE = new Set(["image/jpeg", "image/png", "image/webp"]);
const MEDIA_PATH = "/api/media/";

const mediaUrl = (path: string) =>
  `${window.location.origin}${MEDIA_PATH}${path.split("/").map(encodeURIComponent).join("/")}`;

const postJson = async <T,>(url: string, body: unknown): Promise<T> => {
  const response = await fetch(url, {
    method: "POST",
    headers: { ...moteHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await response.json().catch(() => null)) as (T & { error?: string }) | null;
  if (!response.ok || !data) throw new Error(data?.error || "图片上传失败，请稍后重试");
  return data;
};

/**
 * 浏览器直传工作台的对象存储(不经过服务器中转,快得多):先要限时上传地址,PUT 上去,再请服务器核对。
 * 对象存储不可用或直传失败时返回 undefined,改走服务器上传。
 */
async function uploadDirect(file: File): Promise<string | undefined> {
  const name = file.name || "image.png";
  // purpose: chat —— 聊天附件,服务端按「图片 + 文档」检查(不收视频、音频)
  const sign = await postJson<{ direct: boolean; path?: string; url?: string }>("/api/uploads/direct", {
    step: "sign", name, type: file.type, size: file.size, purpose: "chat",
  });
  if (!sign.direct || !sign.url || !sign.path) return undefined;
  const sent = await fetch(sign.url, { method: "PUT", body: file, headers: { "Content-Type": file.type } })
    .then((response) => response.ok, () => false);
  if (!sent) return undefined;
  const ref = await postJson<{ path: string }>("/api/uploads/direct", {
    step: "complete", name, type: file.type, path: sign.path, purpose: "chat",
  });
  return ref.path;
}

async function uploadViaServer(file: File) {
  const form = new FormData();
  form.append("files", file, file.name || "image.png");
  form.append("purpose", "chat");
  const response = await fetch("/api/uploads", { method: "POST", body: form, headers: moteHeaders() });
  const data = (await response.json().catch(() => null)) as Array<{ path?: string }> | { error?: string } | null;
  const path = Array.isArray(data) ? data[0]?.path : undefined;
  if (!response.ok || !path) {
    throw new Error((data && !Array.isArray(data) && data.error) || "图片上传失败，请稍后重试");
  }
  return path;
}

/** 存到对象存储并记到「附件」页;返回对象路径 */
async function storeAttachment(file: File) {
  const path = (await uploadDirect(file)) ?? (await uploadViaServer(file));
  // 登记失败不影响发送
  void postJson("/api/assets", {
    path, name: file.name || "file", mimeType: file.type || "application/octet-stream", source: "chat",
  }).catch(() => undefined);
  return path;
}

export class MoteImageAttachmentAdapter implements AttachmentAdapter {
  accept = "image/*";
  private inline = new SimpleImageAttachmentAdapter();

  add(state: { file: File }) {
    return this.inline.add(state);
  }

  async send(attachment: PendingAttachment): Promise<CompleteAttachment> {
    // GIF 等工作台存储不收的格式,仍按原来的方式内嵌
    if (!UPLOADABLE.has(attachment.file.type)) return this.inline.send(attachment);
    const path = await storeAttachment(attachment.file);
    return {
      ...attachment,
      status: { type: "complete" },
      content: [{ type: "image", image: mediaUrl(path) }],
    };
  }

  remove() {
    return this.inline.remove();
  }
}

const OFFICE = /\.(docx|xlsx|pptx)$/i;
const PDF = /\.pdf$/i;

/**
 * 文档附件:PDF、Word / Excel / PPT、文本和代码文件(不收视频、音频)。都会另存一份到「附件」页。
 * - PDF:存到对象存储,记录里只放地址,发给模型前和图片一样换成 data URL,以文件形式交给模型读
 * - Word / Excel / PPT:在浏览器里读出文字,作为文本发给模型
 * - 文本 / 代码:直接读出内容作为文本
 */
export class MoteDocumentAttachmentAdapter implements AttachmentAdapter {
  accept = [
    ".pdf", ".docx", ".xlsx", ".pptx", ".txt", ".md", ".markdown", ".csv", ".tsv", ".json", ".xml", ".html", ".htm",
    ".yaml", ".yml", ".log", ".ini", ".toml", ".js", ".jsx", ".ts", ".tsx", ".py", ".java", ".go", ".rs", ".c", ".h", ".cpp",
    ".cs", ".php", ".rb", ".swift", ".kt", ".css", ".scss", ".sql", ".sh", ".bat", ".ps1",
    "application/pdf", "text/plain", "text/markdown", "text/csv", "text/html", "text/xml", "application/json",
  ].join(",");

  async add({ file }: { file: File }): Promise<PendingAttachment> {
    return {
      id: crypto.randomUUID(),
      type: "document",
      name: file.name,
      contentType: file.type || "application/octet-stream",
      file,
      status: { type: "requires-action", reason: "composer-send" },
    };
  }

  async send(attachment: PendingAttachment): Promise<CompleteAttachment> {
    const { file } = attachment;
    if (PDF.test(file.name) || file.type === "application/pdf") {
      const path = await storeAttachment(file);
      return {
        ...attachment,
        status: { type: "complete" },
        content: [{ type: "file", data: mediaUrl(path), mimeType: "application/pdf", filename: file.name }],
      };
    }
    // 文字类:内容直接发给模型;另存一份到附件页(失败不影响发送)
    const text = OFFICE.test(file.name) ? await officeText(file) : await file.text();
    void storeAttachment(file).catch(() => undefined);
    return {
      ...attachment,
      status: { type: "complete" },
      content: [{ type: "text", text: `<attachment name=${file.name}>\n${text}\n</attachment>` }],
    };
  }

  async remove() {}
}

/** 已登录工作台(看图用的 Cookie);直接打开 /chat 时补一次 */
export async function openMoteSession() {
  const headers = moteHeaders();
  if (!headers["x-tangzhi-key"]) return;
  await fetch("/api/session", { method: "POST", headers }).catch(() => undefined);
}

const toDataUrl = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });

/**
 * 发给模型前:把指向工作台存储的图片和 PDF 换成 data URL(模型拿不到需要登录的地址)。
 * 文件已过期或取不到时换成一句文字说明,不让整条请求失败。
 */
export async function inlineMoteImages(messages: UIMessage[]): Promise<UIMessage[]> {
  const prefix = `${window.location.origin}${MEDIA_PATH}`;
  const cache = new Map<string, Promise<string | null>>();
  const load = (url: string) => {
    let pending = cache.get(url);
    if (!pending) {
      pending = fetch(url, { credentials: "same-origin" })
        .then(async (response) => (response.ok ? toDataUrl(await response.blob()) : null))
        .catch(() => null);
      cache.set(url, pending);
    }
    return pending;
  };
  return Promise.all(messages.map(async (message) => {
    if (!message.parts.some((part) => part.type === "file" && part.url.startsWith(prefix))) return message;
    const parts = await Promise.all(message.parts.map(async (part) => {
      if (part.type !== "file" || !part.url.startsWith(prefix)) return part;
      const dataUrl = await load(part.url);
      return dataUrl
        ? { ...part, url: dataUrl }
        : { type: "text" as const, text: `[${part.mediaType?.startsWith("image/") ? "图片" : "文件"}${part.filename ? ` ${part.filename}` : ""} 已过期或无法读取]` };
    }));
    return { ...message, parts } as UIMessage;
  }));
}
