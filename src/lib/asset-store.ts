import { inside } from "./paths";
import { userDir } from "./identity";
import { readJson, writeJsonAtomic } from "./json-store";
import { assertKey, deleteObject } from "./object-store";
import { buildTurns } from "./turns";
import type { AssetKind, Conversation } from "./types";

export interface Asset {
  id: string;
  kind: AssetKind;
  /** 对象存储 key:users/<用户ID>/videos/<文件名>(生成的图片在 images/,上传的素材在 uploads/) */
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
  /** upload:在资产页手动上传的素材;chat:聊天里上传的附件;没有这个字段的是生成结果 */
  source?: "upload" | "chat";
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

/** 批量补记(已经有记录的跳过),返回新补上的条数 */
export async function recordMissingAssets(userId: string, records: AssetRecord[]) {
  if (!records.length) return 0;
  records.forEach((record) => assertKey(record.path));
  return serial(userId, async () => {
    const current = await readIndex(userId);
    const known = new Set(current.map((item) => item.path));
    const added = records.filter((record) => !known.has(record.path) && !isExpired(record));
    if (added.length) await writeJsonAtomic(indexFile(userId), [...added, ...current]);
    return added.length;
  });
}

export async function indexedAssetPaths(userId: string) {
  return new Set((await readIndex(userId)).map((item) => item.path));
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
  const changed = await setAssetsTrashed(userId, [path], trashed);
  if (!changed.length) throw new Error(trashed ? "资产已在回收站" : "资产不在回收站");
  return path;
}

/** 批量移入 / 移出回收站;已经是目标状态的跳过,返回实际改动的路径 */
export async function setAssetsTrashed(userId: string, paths: readonly string[], trashed: boolean) {
  const wanted = new Set(paths);
  return serial(userId, async () => {
    const records = await readIndex(userId);
    if (!records.some((item) => wanted.has(item.path))) throw new Error("资产不存在");
    const changed = records.filter((item) => wanted.has(item.path) && Boolean(item.trashed) !== trashed).map((item) => item.path);
    if (changed.length) {
      await writeJsonAtomic(indexFile(userId), records.map((item) =>
        wanted.has(item.path) ? { ...item, trashed: trashed || undefined } : item));
    }
    return changed;
  });
}

export async function permanentlyDeleteAsset(userId: string, path: string) {
  const { failed } = await permanentlyDeleteAssets(userId, [path]);
  if (failed.length) throw new Error(failed[0].error);
}

/** 批量永久删除:先删文件,删成功的才从索引里去掉;返回删掉的和失败的 */
export async function permanentlyDeleteAssets(userId: string, paths: readonly string[]) {
  const wanted = new Set(paths);
  return serial(userId, async () => {
    const records = await readIndex(userId);
    const targets = records.filter((item) => wanted.has(item.path));
    if (!targets.length) throw new Error("资产不存在");
    const deleted = new Set<string>();
    const failed: { path: string; error: string }[] = [];
    // 每次并发删几个,数量多时也不会一下子打满对象存储
    for (let index = 0; index < targets.length; index += 6) {
      await Promise.all(targets.slice(index, index + 6).map(async ({ path }) => {
        try {
          await deleteObject(path);
          deleted.add(path);
        } catch (error) {
          failed.push({ path, error: (error as Error).message });
        }
      }));
    }
    if (deleted.size) await writeJsonAtomic(indexFile(userId), records.filter((item) => !deleted.has(item.path)));
    return { deleted: [...deleted], failed };
  });
}
