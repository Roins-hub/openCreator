import { indexedAssetPaths, recordMissingAssets, type AssetRecord } from "./asset-store";
import { listChatItems } from "./chat-store";
import { mediaPrefix } from "./identity";
import { MEDIA_RULES, uploadKind } from "./media-files";
import { objectSize } from "./object-store";

/**
 * 聊天附件:聊天里上传的图片存在 users/<用户ID>/uploads/,聊天记录里只留 /api/media/... 地址。
 * 新上传的由聊天页登记到资产索引(source: chat);在这之前上传的,打开附件页时从聊天记录里找出来补记。
 */
const MEDIA_URL = /\/api\/media\/(users\/[0-9a-f]{32}\/uploads\/[^"'\\\s?#)<>]+)/g;
const UPLOAD_NAME = /^(\d{10,})-[0-9a-f]{32}-(.+)$/;
const EXTENSION_TYPES: Record<string, string> = {
  ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp",
  ".mp4": "video/mp4", ".mov": "video/quicktime", ".mp3": "audio/mpeg", ".wav": "audio/wav",
};

const decode = (path: string) => path.split("/").map((part) => {
  try { return decodeURIComponent(part); } catch { return part; }
}).join("/");

/** 聊天记录里引用到的、属于这个用户的上传文件 */
export function chatAttachmentPaths(values: readonly string[], userId: string) {
  const prefix = `${mediaPrefix(userId)}uploads/`;
  const paths = new Set<string>();
  for (const value of values) {
    for (const match of value.matchAll(MEDIA_URL)) {
      const path = decode(match[1]);
      if (path.startsWith(prefix) && !path.slice(prefix.length).includes("/")) paths.add(path);
    }
  }
  return [...paths];
}

/** 从对象 key 还原原文件名和上传时间(key 形如 uploads/<毫秒时间>-<随机串>-<文件名>) */
export function describeUpload(path: string) {
  const file = path.slice(path.lastIndexOf("/") + 1);
  const match = UPLOAD_NAME.exec(file);
  const time = match ? Number(match[1]) : NaN;
  const name = match?.[2] || file;
  const extension = name.includes(".") ? name.slice(name.lastIndexOf(".")).toLowerCase() : "";
  return {
    name,
    createdAt: Number.isFinite(time) ? new Date(time).toISOString() : new Date().toISOString(),
    mimeType: EXTENSION_TYPES[extension] || "",
  };
}

// 同一用户几分钟内只扫描一次聊天记录
const lastSync = new Map<string, number>();
const SYNC_EVERY = 5 * 60_000;

export async function syncChatAttachments(userId: string) {
  const last = lastSync.get(userId) || 0;
  if (Date.now() - last < SYNC_EVERY) return 0;
  lastSync.set(userId, Date.now());
  const entries = await listChatItems(userId);
  const known = await indexedAssetPaths(userId);
  const missing = chatAttachmentPaths(entries.map((entry) => entry.value), userId).filter((path) => !known.has(path));
  const records: AssetRecord[] = [];
  for (let index = 0; index < missing.length; index += 8) {
    const found = await Promise.all(missing.slice(index, index + 8).map(async (path) => {
      const info = describeUpload(path);
      const kind = uploadKind({ name: info.name, type: info.mimeType });
      if (!kind) return undefined;
      // 已过期被对象存储删掉的不补记
      const size = await objectSize(path).catch(() => undefined);
      if (size === undefined) return undefined;
      const record: AssetRecord = {
        kind, path, name: info.name, mimeType: info.mimeType || MEDIA_RULES[kind].types[0], size,
        createdAt: info.createdAt, source: "chat",
      };
      return record;
    }));
    records.push(...found.filter((item): item is AssetRecord => Boolean(item)));
  }
  return recordMissingAssets(userId, records);
}
