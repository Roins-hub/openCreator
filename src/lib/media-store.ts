import { basename, extname } from "node:path";
import { mediaPrefix } from "./identity";
import { uploadKind } from "./media-files";
import { putObject } from "./object-store";
import type { MediaRef } from "./types";

const safeName = (name: string) =>
  basename(name).replace(/[^\p{L}\p{N}._-]+/gu, "-").slice(-80) || "file";

/** 随机文件名(不可猜测)+ 用户目录前缀,存进对象存储。 */
export const mediaKey = (userId: string, folder: "uploads" | "videos", name: string) =>
  `${mediaPrefix(userId)}${folder}/${Date.now()}-${crypto.randomUUID().replace(/-/g, "")}-${safeName(name)}`;

export async function saveUpload(userId: string, file: File): Promise<MediaRef> {
  const kind = uploadKind(file);
  if (!kind) throw new Error("不支持的素材格式");
  const name = file.name || `upload${extname(file.name) || ".bin"}`;
  const key = mediaKey(userId, "uploads", name);
  await putObject(key, new Uint8Array(await file.arrayBuffer()), file.type || "application/octet-stream");
  return { kind, path: key, name: file.name, mimeType: file.type };
}
