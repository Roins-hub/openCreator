import { buildTurns, isGenerationTurn } from "./turns";
import type { Message } from "./types";

export interface NavigationNode {
  id: string;
  preview: string;
  /** 完整提示词(搜索用) */
  text: string;
}

/**
 * 对话目录的每一项对应页面上实际显示的一块:生成记录卡片(id 是生成记录的,
 * 提示词合并在卡片里显示)或没有配对记录的单独提示词。跳转按这个 id 找元素。
 */
export function navigationNodes(messages: Message[]): NavigationNode[] {
  return buildTurns(messages, isGenerationTurn).flatMap((turn) => {
    const prompt = turn.kind === "generation" ? turn.user : turn.message.role === "user" ? turn.message : undefined;
    if (turn.kind === "message" && !prompt) return [];
    const text = (prompt?.content || "").replace(/\s+/g, " ").trim();
    const fallback = prompt?.attachments?.length ? "图片消息" : turn.kind === "generation" ? "生成记录" : "空消息";
    const preview = text || fallback;
    return [{ id: turn.message.id, preview: preview.length > 72 ? `${preview.slice(0, 72)}…` : preview, text: preview }];
  });
}

/** 目录搜索:提示词里包含所有关键词(空格分隔,不分大小写)的项 */
export function searchNavigation(nodes: NavigationNode[], query: string) {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return nodes;
  return nodes.filter((node) => {
    const text = node.text.toLowerCase();
    return words.every((word) => text.includes(word));
  });
}
