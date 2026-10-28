import { buildTurns, isGenerationTurn } from "./turns";
import type { Message } from "./types";

/** 生成记录的结果:成功 / 失败 / 生成中 / 已停止 */
export type TurnStatus = "success" | "failed" | "running" | "stopped";

export function turnStatus(message: Pick<Message, "status">): TurnStatus {
  return message.status === "complete" ? "success"
    : message.status === "processing" ? "running"
      : message.status === "stopped" ? "stopped" : "failed";
}

export interface NavigationNode {
  id: string;
  preview: string;
  /** 完整提示词(搜索用) */
  text: string;
  /** 生成记录的结果(单独的提示词没有) */
  status?: TurnStatus;
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
    return [{
      id: turn.message.id, preview: preview.length > 72 ? `${preview.slice(0, 72)}…` : preview, text: preview,
      ...(turn.kind === "generation" ? { status: turnStatus(turn.message) } : {}),
    }];
  });
}

/** 细线刻度长度:离焦点越近越长(像放大镜),远处是短刻度 */
export const TICK_WIDTHS = [30, 22, 17, 13];
export const tickWidth = (index: number, focus: number) => TICK_WIDTHS[Math.abs(index - focus)] ?? 9;

/** 卡片列表的层次:离焦点几条(带方向,最多算到 ±4),焦点那条凸起,越远越往里凹 */
export const DEPTH_STEPS = 4;
export const depthOffset = (position: number, focus: number) =>
  Math.max(-DEPTH_STEPS, Math.min(DEPTH_STEPS, position - focus));

/** 目录搜索:提示词里包含所有关键词(空格分隔,不分大小写)的项 */
export function searchNavigation(nodes: NavigationNode[], query: string) {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return nodes;
  return nodes.filter((node) => {
    const text = node.text.toLowerCase();
    return words.every((word) => text.includes(word));
  });
}
