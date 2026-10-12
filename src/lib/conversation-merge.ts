import type { Conversation, Message } from "./types";

/** 浏览器里还没拿到服务端结果的占位消息 */
export const isPendingMessageId = (id: string) => id.startsWith("pending-");

/**
 * 服务端保存时合并:标题、模型等取浏览器提交的值;
 * 消息保留服务端版本(任务状态由服务端维护),只删掉明确要删的,浏览器新加的追加在后面。
 */
export function mergeConversation(stored: Conversation | null, incoming: Conversation, removedIds: string[] = []): Conversation {
  const removed = new Set(removedIds);
  const keep = (message: Message) => !removed.has(message.id) && !isPendingMessageId(message.id);
  if (!stored) return { ...incoming, messages: incoming.messages.filter(keep) };
  const known = new Set(stored.messages.map((message) => message.id));
  return {
    ...incoming,
    messages: [
      ...stored.messages.filter(keep),
      ...incoming.messages.filter((message) => keep(message) && !known.has(message.id)),
    ],
  };
}

/**
 * 浏览器用服务端返回的对话替换本地副本时,保留还在提交中的本地消息
 * (用户消息、生成占位),否则并发提交时它们会闪没。
 */
export function keepLocalMessages(saved: Conversation, local: Conversation | undefined, keepIds: ReadonlySet<string>): Conversation {
  if (!local) return saved;
  const known = new Set(saved.messages.map((message) => message.id));
  const extra = local.messages.filter((message) => keepIds.has(message.id) && !known.has(message.id));
  return extra.length ? { ...saved, messages: [...saved.messages, ...extra] } : saved;
}

/** 用服务端的消息替换本地同 ID 的消息(轮询任务状态时只更新这一条) */
export function patchMessage(conversation: Conversation, message: Message, replaceId = message.id): Conversation {
  const index = conversation.messages.findIndex((item) => item.id === replaceId);
  if (index === -1) {
    if (replaceId === message.id || conversation.messages.some((item) => item.id === message.id)) return conversation;
    return { ...conversation, messages: [...conversation.messages, message] };
  }
  const messages = conversation.messages.filter((item, position) => position === index || item.id !== message.id);
  return { ...conversation, messages: messages.map((item) => item.id === replaceId ? message : item) };
}
