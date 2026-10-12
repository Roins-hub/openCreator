import { mkdir, readdir, rm } from "node:fs/promises";
import { inside } from "./paths";
import { userDir } from "./identity";
import { readJson, writeJsonAtomic } from "./json-store";
import { conversationSchema } from "./schemas";
import type { Conversation } from "./types";
import { mergeConversation } from "./conversation-merge";

/** 每个用户的对话单独存放在 data/users/<用户ID>/conversations。 */
const conversationsDir = (userId: string) => inside(userDir(userId), "conversations");
const filePath = (userId: string, id: string) => {
  if (!/^[\w-]{1,80}$/.test(id)) throw new Error("会话 ID 不正确");
  return inside(conversationsDir(userId), `${id}.json`);
};

export async function listConversations(userId: string) {
  const dir = conversationsDir(userId);
  await mkdir(dir, { recursive: true });
  const files = (await readdir(dir)).filter((file) => file.endsWith(".json"));
  const conversations = await Promise.all(files.map((file) =>
    readJson<Conversation | null>(inside(dir, file), null)));
  return conversations.filter((item): item is Conversation => Boolean(item))
    .map((item) => conversationSchema.parse(item))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function getConversation(userId: string, id: string) {
  const value = await readJson<Conversation | null>(filePath(userId, id), null);
  return value ? conversationSchema.parse(value) : null;
}

async function writeConversation(userId: string, value: unknown) {
  const conversation = conversationSchema.parse(value);
  await writeJsonAtomic(filePath(userId, conversation.id), conversation);
  return conversation;
}

/**
 * 同一对话的读-改-写按顺序执行:并发提交生成、轮询任务、改标题时,
 * 后写的一方不会用旧数据覆盖前一方刚加入的消息。(单进程部署,内存队列即可)
 */
const queues = new Map<string, Promise<void>>();
function withConversationLock<T>(userId: string, id: string, task: () => Promise<T>): Promise<T> {
  const key = `${userId}/${id}`;
  const run = (queues.get(key) || Promise.resolve()).then(task);
  const tail = run.then(() => undefined, () => undefined);
  queues.set(key, tail);
  void tail.then(() => { if (queues.get(key) === tail) queues.delete(key); });
  return run;
}

/** 在锁内读取最新对话、修改并保存;对话不存在时报错。 */
export function updateConversation(
  userId: string, id: string, update: (conversation: Conversation) => void | Promise<void>,
) {
  return withConversationLock(userId, id, async () => {
    const conversation = await getConversation(userId, id);
    if (!conversation) throw new Error("会话不存在");
    await update(conversation);
    return writeConversation(userId, conversation);
  });
}

/**
 * 保存浏览器提交的对话(新建或改标题、模型、参数、删除记录)。
 * 消息以服务端为准,只删除明确列出的,避免浏览器里的旧副本冲掉刚生成的任务。
 */
export function saveConversation(userId: string, value: unknown, removedMessageIds: string[] = []) {
  const incoming = conversationSchema.parse(value);
  return withConversationLock(userId, incoming.id, async () =>
    writeConversation(userId, mergeConversation(await getConversation(userId, incoming.id), incoming, removedMessageIds)));
}

export async function deleteConversation(userId: string, id: string) {
  await withConversationLock(userId, id, () => rm(filePath(userId, id), { force: true }));
}
