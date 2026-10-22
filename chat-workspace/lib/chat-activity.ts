/**
 * 每个聊天最近一次有新消息的时间(侧栏悬停卡片显示用)。
 * 列表加载时从存储读一次;这次打开页面后发 / 收的消息直接记在这里,不用重新加载列表。
 */
const activity = new Map<string, Date>();

export function noteChatActivity(threadId: string, at = new Date()) {
  const current = activity.get(threadId);
  if (!current || at > current) activity.set(threadId, at);
}

export const chatActivity = (threadId: string) => activity.get(threadId);
