import type { Message } from "./types";

export type Turn =
  | { kind: "generation"; message: Message; user?: Message }
  | { kind: "message"; message: Message };

/**
 * 把对话消息整理成「提示词 + 生成记录」:
 * - 新记录用 replyTo 指明自己的提示词(并发生成时两者不再相邻);
 * - 没有 replyTo 的旧记录按位置推断:一段连续提示词后面跟着一段生成记录,
 *   数量相同就按顺序一一对应(并发提交),不同就从后往前对(多出来的是提交失败的提示词);
 * - 配不上任何记录的提示词单独显示,可以删除或重新编辑。
 */
export function buildTurns(messages: Message[], isGeneration: (message: Message) => boolean): Turn[] {
  const byId = new Map(messages.map((message) => [message.id, message]));
  const owner = new Map<string, Message>();
  const claimed = new Set<string>();
  for (const message of messages) {
    const user = message.replyTo ? byId.get(message.replyTo) : undefined;
    if (isGeneration(message) && user?.role === "user" && !claimed.has(user.id)) {
      owner.set(message.id, user);
      claimed.add(user.id);
    }
  }

  let users: Message[] = [];
  let records: Message[] = [];
  const flush = () => {
    if (!records.length) return;
    const offset = users.length === records.length ? 0 : users.length - records.length;
    records.forEach((record, index) => {
      const user = users[offset + index];
      if (!user) return;
      owner.set(record.id, user);
      claimed.add(user.id);
    });
    users = [];
    records = [];
  };
  for (const message of messages) {
    if (message.role === "user") {
      if (claimed.has(message.id)) continue;
      flush();
      users.push(message);
    } else if (isGeneration(message)) {
      if (!owner.has(message.id)) records.push(message);
    } else {
      flush();
      users = [];
    }
  }
  flush();

  return messages.flatMap((message): Turn[] => {
    if (message.role === "user" && claimed.has(message.id)) return [];
    if (isGeneration(message)) return [{ kind: "generation", message, user: owner.get(message.id) }];
    return [{ kind: "message", message }];
  });
}

/** 生图记录:有生图快照,或旧记录只产出了图片 */
export function isImageRecord(message: Message) {
  if (message.generation) return message.generation.type === "image";
  return Boolean(message.media?.length && message.media.every((item) => item.kind === "image"));
}

/** 显示成任务卡片的生成记录(视频或图片) */
export function isGenerationTurn(message: Message) {
  if (message.role !== "assistant") return false;
  if (message.generation) return message.generation.type === "video" || message.generation.type === "image";
  if (isImageRecord(message)) return true;
  if (message.media?.some((item) => item.kind === "video")) return true;
  // 旧记录没有 generation 快照:有任务 ID 或正在生成时按视频任务展示。
  const hasTask = message.taskIds?.length || message.taskId || message.id.startsWith("pending-");
  return Boolean(hasTask || message.status === "processing");
}
