import { access, mkdir, readdir, rename, stat, unlink } from "node:fs/promises";
import path from "node:path";
import type { Conversation } from "./types";
import { inside, outDir } from "./paths";

export interface Asset {
  id: string;
  kind: "image" | "video";
  path: string;
  name: string;
  mimeType: string;
  size: number;
  modifiedAt: string;
  createdAt?: string;
  conversationId?: string;
  conversationTitle?: string;
  trashed?: boolean;
  originalPath?: string;
  favorite?: boolean;
}

export function enrichAssets(assets: Asset[], conversations: Conversation[]) {
  const sources = new Map<string, Pick<Asset, "createdAt" | "conversationId" | "conversationTitle">>();
  for (const conversation of conversations) {
    for (const message of conversation.messages) {
      for (const media of message.media || []) {
        sources.set(media.path, {
          createdAt: message.createdAt,
          conversationId: conversation.id,
          conversationTitle: conversation.title,
        });
      }
    }
  }

  return assets.map((asset) => ({
    ...asset,
    ...sources.get(asset.originalPath || asset.path),
  }))
    .sort((a, b) => (b.createdAt || b.modifiedAt).localeCompare(a.createdAt || a.modifiedAt));
}

function parseAssetPath(relativePath: string) {
  const match = /^(\.trash\/)?(images|videos)\/([^/]+)$/.exec(relativePath);
  if (!match || [".", ".."].includes(match[3])) throw new Error("非法资产路径");
  const kind = match[2] === "images" ? "image" as const : "video" as const;
  const extension = path.extname(match[3]).toLowerCase();
  const allowed = kind === "image" ? [".png", ".jpg", ".jpeg", ".webp"] : [".mp4"];
  if (!allowed.includes(extension)) throw new Error("非法资产路径");
  return {
    trashed: Boolean(match[1]),
    folder: match[2],
    name: match[3],
    kind,
    originalPath: `${match[2]}/${match[3]}`,
  };
}

async function destinationAvailable(target: string) {
  try {
    await access(target);
    throw new Error("同名资产已存在");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

export async function moveAssetToTrash(relativePath: string, root = outDir) {
  const asset = parseAssetPath(relativePath);
  if (asset.trashed) throw new Error("资产已在回收站");
  const source = inside(root, asset.folder, asset.name);
  const destinationDirectory = inside(root, ".trash", asset.folder);
  const destination = inside(destinationDirectory, asset.name);
  await mkdir(destinationDirectory, { recursive: true });
  await destinationAvailable(destination);
  await rename(source, destination);
  return `.trash/${asset.originalPath}`;
}

export async function restoreAsset(relativePath: string, root = outDir) {
  const asset = parseAssetPath(relativePath);
  if (!asset.trashed) throw new Error("资产不在回收站");
  const source = inside(root, ".trash", asset.folder, asset.name);
  const destination = inside(root, asset.folder, asset.name);
  await mkdir(inside(root, asset.folder), { recursive: true });
  await destinationAvailable(destination);
  await rename(source, destination);
  return asset.originalPath;
}

export async function permanentlyDeleteAsset(relativePath: string, root = outDir) {
  const asset = parseAssetPath(relativePath);
  const target = asset.trashed
    ? inside(root, ".trash", asset.folder, asset.name)
    : inside(root, asset.folder, asset.name);
  await unlink(target);
}

async function scanAssetFolder(
  assets: Asset[], root: string, folder: "images" | "videos", trashed = false,
) {
  const directory = trashed ? path.join(root, ".trash", folder) : path.join(root, folder);
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const relativePath = `${folder}/${entry.name}`;
    const exposedPath = trashed ? `.trash/${relativePath}` : relativePath;
    let parsed: ReturnType<typeof parseAssetPath>;
    try { parsed = parseAssetPath(exposedPath); } catch { continue; }
    const details = await stat(path.join(directory, entry.name));
    const extension = entry.name.split(".").pop()?.toLowerCase();
    assets.push({
      id: exposedPath,
      kind: parsed.kind,
      path: exposedPath,
      name: path.basename(entry.name),
      mimeType: parsed.kind === "video" ? "video/mp4" :
        extension === "png" ? "image/png" : extension === "webp" ? "image/webp" : "image/jpeg",
      size: details.size, modifiedAt: details.mtime.toISOString(),
      ...(trashed ? { trashed: true, originalPath: relativePath } : {}),
    });
  }
}

export async function indexAssets(conversations: Conversation[]): Promise<Asset[]> {
  const assets: Asset[] = [];
  const root = outDir;
  await scanAssetFolder(assets, root, "images");
  await scanAssetFolder(assets, root, "videos");
  await scanAssetFolder(assets, root, "images", true);
  await scanAssetFolder(assets, root, "videos", true);
  return enrichAssets(assets, conversations);
}
