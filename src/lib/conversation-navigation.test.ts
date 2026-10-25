import { describe, expect, it } from "vitest";
import { navigationNodes, searchNavigation } from "./conversation-navigation";
import type { Message } from "./types";

const message = (id: string, role: Message["role"], content: string): Message => ({
  id, role, content, createdAt: "2026-07-23T00:00:00.000Z", status: "complete",
});

describe("conversation navigation", () => {
  it("uses user turns and produces compact single-line previews", () => {
    const nodes = navigationNodes([
      message("u1", "user", "  第一行\n第二行  "),
      message("a1", "assistant", "回答"),
      { ...message("u2", "user", ""), attachments: [{
        kind: "image", path: "uploads/a.png", name: "a.png",
      }] },
    ]);
    expect(nodes).toEqual([
      { id: "u1", preview: "第一行 第二行", text: "第一行 第二行" },
      { id: "u2", preview: "图片消息", text: "图片消息" },
    ]);
  });

  it("points generation records at their card, with the prompt as preview", () => {
    const nodes = navigationNodes([
      message("u1", "user", "海边的灯塔"),
      { ...message("v1", "assistant", ""), replyTo: "u1", taskId: "tz.task_1", status: "processing" },
      message("u2", "user", "提交失败的提示词"),
    ]);
    expect(nodes).toEqual([
      { id: "v1", preview: "海边的灯塔", text: "海边的灯塔" },
      { id: "u2", preview: "提交失败的提示词", text: "提交失败的提示词" },
    ]);
  });

  it("searches the full prompt with every keyword", () => {
    const long = `开头${"很长的描述".repeat(20)}结尾有只猫`;
    const nodes = navigationNodes([message("u1", "user", long), message("u2", "user", "海边 Lighthouse")]);
    expect(nodes[0].preview.endsWith("…")).toBe(true);
    expect(searchNavigation(nodes, "猫").map((node) => node.id)).toEqual(["u1"]);
    expect(searchNavigation(nodes, "海边 lighthouse").map((node) => node.id)).toEqual(["u2"]);
    expect(searchNavigation(nodes, "海边 猫")).toEqual([]);
    expect(searchNavigation(nodes, "  ")).toHaveLength(2);
  });
});
