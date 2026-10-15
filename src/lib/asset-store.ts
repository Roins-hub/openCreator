import { inside } from "./paths";
import { userDir } from "./identity";
import { readJson, writeJsonAtomic } from "./json-store";
import { assertKey, deleteObject } from "./object-store";
import { buildTurns } from "./turns";
import type { Conversation } from "./types";

export interface Asset {
  id: string;
  kind: "image" | "video";
  /** 对象存储 key:users/<用户ID>/videos/<文件名> */
  path: string;
  name: string;
  mimeType: string;
  size: number;
  createdAt: string;
  conversationId?: string;
  conversationTitle?: string;
  /** 生成这个视频 / 图片的提示词,用于搜索 */
  prompt?: string;
  trashed?: boolean;
  favorite?: boolean;
}

export type AssetRecord = Omit<Asset, "id" | "conversationTitle" | "prompt" | "favorite">;

/** 生成结果的索引:文件在对象存储里,索引记录名称、大小、来源对话和回收站状态。 */
const indexFile = (userId: string) => inside(userDir(userId), "assets.json");

/** 云存储按生命周期规则自动删除旧文件;设置了保留天数时,过期记录不再显示。 */
export function retentionDays() {
  const days = Number(process.env.MOTE_RETENTION_DAYS);
  return Number.isFinite(days) && days > 0 ? days : undefined;
}

export function isExpired(record: Pick<AssetRecord, "createdAt">, days = retentionDays(), now = Date.now()) {
  return Boolean(days && now - new Date(record.createdAt).getTime() > days * 86_400_000);
}

// 同一用户的索引读改写按顺序执行:多张图 / 多条视频同时完成时不会互相覆盖丢记录
const queues = new Map<string, Promise<unknown>>();
function serial<T>(userId: string, task: () => Promise<T>) {
  const result = (queues.get(userId) || Promise.resolve()).then(task, task);
  const tail = result.catch(() => undefined);
  queues.set(userId, tail);
  void tail.then(() => { if (queues.get(userId) === tail) queues.delete(userId); });
  return result;
}

async function readIndex(userId: string) {
  const value = await readJson<AssetRecord[]>(indexFile(userId), []);
  return Array.isArray(value) ? value : [];
}

export async function recordAsset(userId: string, record: AssetRecord) {
  assertKey(record.path);
  await serial(userId, async () => {
    const current = (await readIndex(userId)).filter((item) => item.path !== record.path && !isExpired(item));
    await writeJsonAtomic(indexFile(userId), [record, ...current]);
  });
}

export function enrichAssets(records: AssetRecord[], conversations: Conversation[], favorites: string[] = []) {
  const titles = new Map(conversations.map((item) => [item.id, item.title]));
  // 视频 / 图片路径 -> 生成它的提示词
  const prompts = new Map<string, string>();
  for (const conversation of conversations) {
    for (const turn of buildTurns(conversation.messages, (message) => message.role === "assistant")) {
      if (turn.kind !== "generation" || !turn.user?.content) continue;
      for (const media of turn.message.media || []) prompts.set(media.path, turn.user.content);
    }
  }
  const favoriteSet = new Set(favorites);
  return records
    .filter((record) => !isExpired(record))
    .map((record): Asset => ({
      ...record,
      id: record.path,
      conversationTitle: record.conversationId ? titles.get(record.conversationId) : undefined,
      prompt: prompts.get(record.path),
      conversationId: record.conversationId && titles.has(record.conversationId) ? record.conversationId : undefined,
      favorite: favoriteSet.has(record.path),
    }))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function listAssets(userId: string, conversations: Conversation[], favorites: string[]) {
  return enrichAssets(await readIndex(userId), conversations, favorites);
}

export async function setAssetTrashed(userId: string, path: string, trashed: boolean) {
  return serial(userId, () => updateTrashed(userId, path, trashed));
}

async function updateTrashed(userId: string, path: string, trashed: boolean) {
  const records = await readIndex(userId);
  const record = records.find((item) => item.path === path);
  if (!record) throw new Error("资产不存在");
  if (Boolean(record.trashed) === trashed) throw new Error(trashed ? "资产已在回收站" : "资产不在回收站");
  await writeJsonAtomic(indexFile(userId), records.map((item) =>
    item.path === path ? { ...item, trashed: trashed || undefined } : item));
  return path;
}

export async function permanentlyDeleteAsset(userId: string, path: string) {
  await serial(userId, async () => {
    const records = await readIndex(userId);
    if (!records.some((item) => item.path === path)) throw new Error("资产不存在");
    await deleteObject(path);
    await writeJsonAtomic(indexFile(userId), records.filter((item) => item.path !== path));
  });
}
