import { inside } from "./paths";
import { userDir } from "./identity";
import { readJson, writeJsonAtomic } from "./json-store";
import { assertKey, deleteObject } from "./object-store";
import { dropDerived, prepareDerived } from "./media-derived";
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
  /** 所在分组的 ID(在 @ 选择素材时整理的分组);没有就是未分组 */
  folder?: string;
}

/** 素材分组 */
export interface AssetFolder {
  id: string;
  name: string;
  createdAt: string;
  /** chat:聊天附件页的文件夹;没有:工作台素材(资产页、@ 选择素材)的文件夹 */
  scope?: "chat";
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
  // 后台先把缩略图、放大查看的大图生成好(存储不支持处理时什么都不做)
  prepareDerived(record.path, record.kind);
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

/**
 * @ 选择素材用的精简列表:只要能当参考素材的(不含回收站里的、文档附件),
 * 不读对话、不带提示词和来源对话,数据小、返回快。
 */
export async function listPickerAssets(userId: string) {
  return (await readIndex(userId))
    .filter((record) => !isExpired(record) && !record.trashed && record.kind !== "file")
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map(({ kind, path, name, mimeType, size, createdAt, folder, source }) => ({
      id: path, kind, path, name, mimeType, size, createdAt,
      ...(folder ? { folder } : {}), ...(source ? { source } : {}),
    }));
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
    if (deleted.size) {
      await writeJsonAtomic(indexFile(userId), records.filter((item) => !deleted.has(item.path)));
      await dropDerived([...deleted]).catch(() => undefined);
    }
    return { deleted: [...deleted], failed };
  });
}

/** 改名(只改显示名;没写扩展名时沿用原来的,下载下来还能直接打开) */
export async function renameAsset(userId: string, path: string, name: string) {
  const trimmed = name.trim().slice(0, 300);
  if (!trimmed) throw new Error("名称不能为空");
  return serial(userId, async () => {
    const records = await readIndex(userId);
    const target = records.find((item) => item.path === path);
    if (!target) throw new Error("资产不存在");
    const extension = /\.[a-z0-9]{1,6}$/i.exec(target.name)?.[0] || "";
    const next = extension && !trimmed.toLowerCase().endsWith(extension.toLowerCase()) ? `${trimmed}${extension}` : trimmed;
    await writeJsonAtomic(indexFile(userId), records.map((item) => item.path === path ? { ...item, name: next } : item));
    return next;
  });
}

// ---- 素材分组:分组列表单独存一个文件,资产记录里只记分组 ID ----
const foldersFile = (userId: string) => inside(userDir(userId), "asset-folders.json");
const MAX_FOLDERS = 200;

async function readFolders(userId: string) {
  const value = await readJson<AssetFolder[]>(foldersFile(userId), []);
  return Array.isArray(value) ? value.filter((item) => item && typeof item.id === "string" && typeof item.name === "string") : [];
}

export async function listAssetFolders(userId: string, scope?: "chat") {
  return (await readFolders(userId)).filter((folder) => folder.scope === scope);
}

const folderName = (name: string) => {
  const trimmed = name.trim().slice(0, 40);
  if (!trimmed) throw new Error("分组名称不能为空");
  return trimmed;
};

/** 新建分组;带 paths 时顺便把这些素材移进去(拖到「新建分组」上) */
export async function createAssetFolder(userId: string, name: string, paths: readonly string[] = [], scope?: "chat") {
  const folder: AssetFolder = {
    id: crypto.randomUUID(), name: folderName(name), createdAt: new Date().toISOString(), ...(scope ? { scope } : {}),
  };
  await serial(userId, async () => {
    const folders = await readFolders(userId);
    if (folders.length >= MAX_FOLDERS) throw new Error(`最多 ${MAX_FOLDERS} 个分组`);
    await writeJsonAtomic(foldersFile(userId), [...folders, folder]);
  });
  if (paths.length) await moveAssets(userId, paths, folder.id);
  return folder;
}

export async function renameAssetFolder(userId: string, id: string, name: string) {
  const next = folderName(name);
  return serial(userId, async () => {
    const folders = await readFolders(userId);
    if (!folders.some((item) => item.id === id)) throw new Error("分组不存在");
    await writeJsonAtomic(foldersFile(userId), folders.map((item) => item.id === id ? { ...item, name: next } : item));
    return next;
  });
}

/**
 * 调整文件夹顺序:order 里的文件夹按这个顺序排,占用它们原来的位置
 * (另一边的文件夹——聊天附件 / 工作台素材——和没列出来的位置不动)
 */
export async function reorderAssetFolders(userId: string, order: readonly string[]) {
  const wanted = new Set(order);
  return serial(userId, async () => {
    const folders = await readFolders(userId);
    const byId = new Map(folders.map((folder) => [folder.id, folder]));
    const sorted = order.map((id) => byId.get(id)).filter((folder): folder is AssetFolder => Boolean(folder));
    let next = 0;
    const result = folders.map((folder) => wanted.has(folder.id) && next < sorted.length ? sorted[next++] : folder);
    await writeJsonAtomic(foldersFile(userId), result);
    return result.map((folder) => folder.id);
  });
}

/** 删除分组:里面的素材不删,回到未分组 */
export async function deleteAssetFolder(userId: string, id: string) {
  await serial(userId, async () => {
    const folders = await readFolders(userId);
    await writeJsonAtomic(foldersFile(userId), folders.filter((item) => item.id !== id));
    const records = await readIndex(userId);
    if (records.some((item) => item.folder === id)) {
      await writeJsonAtomic(indexFile(userId), records.map((item) => {
        if (item.folder !== id) return item;
        const { folder: _folder, ...rest } = item;
        void _folder;
        return rest;
      }));
    }
  });
}

/** 把素材移到分组(folder 为 undefined 时移出分组);返回实际移动的路径 */
export async function moveAssets(userId: string, paths: readonly string[], folder: string | undefined) {
  const wanted = new Set(paths);
  return serial(userId, async () => {
    if (folder && !(await readFolders(userId)).some((item) => item.id === folder)) throw new Error("分组不存在");
    const records = await readIndex(userId);
    const moved = records.filter((item) => wanted.has(item.path) && item.folder !== folder).map((item) => item.path);
    if (moved.length) {
      await writeJsonAtomic(indexFile(userId), records.map((item) => {
        if (!wanted.has(item.path)) return item;
        const { folder: _folder, ...rest } = item;
        void _folder;
        return folder ? { ...rest, folder } : rest;
      }));
    }
    return moved;
  });
}
