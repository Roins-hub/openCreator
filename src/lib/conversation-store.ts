import { mkdir, readdir, rm } from "node:fs/promises";
import { inside } from "./paths";
import { userDir } from "./identity";
import { readJson, writeJsonAtomic } from "./json-store";
import { conversationSchema } from "./schemas";
import type { Conversation } from "./types";

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

export async function saveConversation(userId: string, value: unknown) {
  const conversation = conversationSchema.parse(value);
  await writeJsonAtomic(filePath(userId, conversation.id), conversation);
  return conversation;
}

export async function deleteConversation(userId: string, id: string) {
  await rm(filePath(userId, id), { force: true });
}
