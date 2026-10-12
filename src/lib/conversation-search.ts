import type { Conversation } from "./types";

export interface ConversationSearchResult {
  conversation: Conversation;
  snippet: string;
  titleMatch: boolean;
}

function compact(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function snippetAround(content: string, query: string) {
  const text = compact(content);
  if (!text) return "";
  const index = text.toLocaleLowerCase().indexOf(query);
  if (index < 0) return text.slice(0, 88);
  const start = Math.max(0, index - 30);
  const end = Math.min(text.length, index + query.length + 52);
  return `${start ? "…" : ""}${text.slice(start, end)}${end < text.length ? "…" : ""}`;
}

/** 标题或任意一条消息包含关键词(忽略大小写和多余空白);关键词为空时全部匹配 */
export function matchConversation(conversation: Conversation, rawQuery: string) {
  const query = compact(rawQuery).toLocaleLowerCase();
  if (!query) return true;
  return conversation.title.toLocaleLowerCase().includes(query)
    || conversation.messages.some((message) => compact(message.content).toLocaleLowerCase().includes(query));
}

export function searchConversations(
  conversations: Conversation[], rawQuery: string, limit = 30,
): ConversationSearchResult[] {
  const query = compact(rawQuery).toLocaleLowerCase();
  return conversations.flatMap((conversation) => {
    const titleMatch = conversation.title.toLocaleLowerCase().includes(query);
    const matchingMessage = query
      ? conversation.messages.find((message) =>
        compact(message.content).toLocaleLowerCase().includes(query))
      : [...conversation.messages].reverse().find((message) => compact(message.content));
    if (query && !titleMatch && !matchingMessage) return [];
    return [{
      conversation,
      titleMatch,
      snippet: matchingMessage ? snippetAround(matchingMessage.content, query) : "",
    }];
  }).sort((a, b) => {
    if (query && a.titleMatch !== b.titleMatch) return a.titleMatch ? -1 : 1;
    return b.conversation.updatedAt.localeCompare(a.conversation.updatedAt);
  }).slice(0, limit);
}
