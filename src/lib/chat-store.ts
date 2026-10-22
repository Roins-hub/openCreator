import { createHash } from "node:crypto";
import { mkdir, readdir, rm, stat } from "node:fs/promises";
import { z } from "zod";
import { userDir } from "./identity";
import { readJson, writeJsonAtomic } from "./json-store";
import { inside } from "./paths";

/**
 * 「对话」(vip.tangzhi.org/chat)的聊天记录:聊天程序把线程列表、每个线程的消息
 * 当成键值对存取(键形如 sub2chat:threads、sub2chat:messages:<线程ID>),
 * 这里按用户存在 data/users/<用户ID>/chat-store/<键的哈希>.json,随中转站账号走。
 */
const KEY_PATTERN = /^sub2chat:[\x21-\x7e]{1,300}$/;
// 消息里可能内嵌图片附件(单个 ≤10MB,base64 后约 13MB)
export const MAX_VALUE_BYTES = 40 * 1024 * 1024;
export const MAX_ENTRIES = 5000;

export const chatKeySchema = z.string().regex(KEY_PATTERN, "聊天记录的键不正确");
const entrySchema = z.object({
  key: chatKeySchema,
  value: z.string().max(MAX_VALUE_BYTES, "单条聊天记录过大"),
});
export type ChatEntry = z.infer<typeof entrySchema>;

const storeDir = (userId: string) => inside(userDir(userId), "chat-store");
const entryFile = (userId: string, key: string) =>
  inside(storeDir(userId), `${createHash("sha256").update(key).digest("hex").slice(0, 40)}.json`);

// 同一个键的写入按顺序执行(聊天程序会连续追加消息)
const tails = new Map<string, Promise<unknown>>();
function serial<T>(lockKey: string, task: () => Promise<T>) {
  const result = (tails.get(lockKey) || Promise.resolve()).then(task, task);
  const tail = result.catch(() => undefined);
  tails.set(lockKey, tail);
  void tail.then(() => { if (tails.get(lockKey) === tail) tails.delete(lockKey); });
  return result;
}

export async function getChatItem(userId: string, key: string) {
  chatKeySchema.parse(key);
  const entry = await readJson<ChatEntry | null>(entryFile(userId, key), null);
  return entry?.key === key ? entry.value : null;
}

export async function setChatItem(userId: string, input: unknown) {
  const { key, value } = entrySchema.parse(input);
  await serial(`${userId}:${key}`, async () => {
    await mkdir(storeDir(userId), { recursive: true });
    await writeJsonAtomic(entryFile(userId, key), { key, value, updatedAt: new Date().toISOString() });
  });
}

export async function removeChatItem(userId: string, key: string) {
  chatKeySchema.parse(key);
  await serial(`${userId}:${key}`, () => rm(entryFile(userId, key), { force: true }));
}

export const MAX_TIME_KEYS = 500;

/**
 * 一批键最后一次写入的时间(聊天列表显示每个聊天的最近时间用)。只看文件修改时间,不读内容;
 * 不存在的键不返回。
 */
export async function chatItemTimes(userId: string, keys: readonly string[]) {
  const unique = [...new Set(keys)].slice(0, MAX_TIME_KEYS).filter((key) => chatKeySchema.safeParse(key).success);
  const times: Record<string, string> = {};
  await Promise.all(unique.map(async (key) => {
    const info = await stat(entryFile(userId, key)).catch(() => undefined);
    if (info) times[key] = info.mtime.toISOString();
  }));
  return times;
}

export async function listChatItems(userId: string): Promise<ChatEntry[]> {
  const files = await readdir(storeDir(userId)).catch(() => [] as string[]);
  const entries = await Promise.all(files.filter((name) => name.endsWith(".json")).map((name) =>
    readJson<ChatEntry | null>(inside(storeDir(userId), name), null)));
  return entries
    .filter((entry): entry is ChatEntry => Boolean(entry && KEY_PATTERN.test(entry.key) && typeof entry.value === "string"))
    .map(({ key, value }) => ({ key, value }));
}

export async function clearChatItems(userId: string) {
  await rm(storeDir(userId), { recursive: true, force: true });
}

/** 导入备份:替换全部聊天记录(与聊天程序原来的导入行为一致) */
export async function importChatItems(userId: string, input: unknown) {
  const entries = z.array(entrySchema).max(MAX_ENTRIES, `备份最多 ${MAX_ENTRIES} 条`).parse(input);
  await clearChatItems(userId);
  for (const entry of entries) await setChatItem(userId, entry);
  return entries.length;
}
