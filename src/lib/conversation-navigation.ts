import { buildTurns, isGenerationTurn } from "./turns";
import type { Message } from "./types";

export interface NavigationNode {
  id: string;
  preview: string;
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
    return [{ id: turn.message.id, preview: preview.length > 72 ? `${preview.slice(0, 72)}…` : preview }];
  });
}

export function navigationWindow(
  nodes: NavigationNode[],
  activeIndex: number,
  maximum = 7,
) {
  if (nodes.length <= maximum) return nodes;
  const start = Math.min(
    Math.max(0, activeIndex - Math.floor(maximum / 2)),
    nodes.length - maximum,
  );
  return nodes.slice(start, start + maximum);
}
