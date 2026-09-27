import { mkdir, writeFile } from "node:fs/promises";
import { basename, extname } from "node:path";
import { inside, outDir } from "./paths";
import { uploadKind } from "./media-files";
import type { MediaRef } from "./types";

const safeName = (name: string) =>
  basename(name).replace(/[^\p{L}\p{N}._-]+/gu, "-").slice(-100) || "file";

export async function saveUpload(file: File): Promise<MediaRef> {
  const kind = uploadKind(file);
  if (!kind) throw new Error("不支持的素材格式");
  const extension = extname(file.name) || ".bin";
  const name = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}-${safeName(file.name || `upload${extension}`)}`;
  const relative = `uploads/${name}`;
  const target = inside(outDir, relative);
  await mkdir(inside(outDir, "uploads"), { recursive: true });
  await writeFile(target, Buffer.from(await file.arrayBuffer()));
  return { kind, path: relative, name: file.name, mimeType: file.type };
}
