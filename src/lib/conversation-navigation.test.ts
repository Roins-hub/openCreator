import { describe, expect, it } from "vitest";
import { depthOffset, navigationNodes, searchNavigation, tickWidth, turnStatus } from "./conversation-navigation";
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
      { id: "v1", preview: "海边的灯塔", text: "海边的灯塔", status: "running" },
      { id: "u2", preview: "提交失败的提示词", text: "提交失败的提示词" },
    ]);
  });

  it("draws longer ticks near the focus, like a magnifier", () => {
    expect([0, 1, 2, 3, 4, 5, 6, 7, 8].map((index) => tickWidth(index, 4))).toEqual([9, 13, 17, 22, 30, 22, 17, 13, 9]);
    expect(tickWidth(20, 4)).toBe(9);
  });

  it("gives card items a signed depth around the focus, capped at four steps", () => {
    expect([0, 2, 5, 6, 7, 12].map((position) => depthOffset(position, 6))).toEqual([-4, -4, -1, 0, 1, 4]);
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

  it("maps each generation record to a result status", () => {
    expect(["complete", "failed", "processing", "stopped"].map((status) => turnStatus({ status } as never)))
      .toEqual(["success", "failed", "running", "stopped"]);
    const at = "2026-10-28T00:00:00Z";
    const nodes = navigationNodes([
      { id: "u1", role: "user", content: "猫", createdAt: at, status: "complete" },
      { id: "a1", role: "assistant", content: "", createdAt: at, status: "failed", replyTo: "u1", generation: { type: "image", providerName: "", modelName: "m", modelId: "m" } },
      { id: "u2", role: "user", content: "只有提示词", createdAt: at, status: "complete" },
    ] as never);
    expect(nodes.map((node) => [node.id, node.status])).toEqual([["a1", "failed"], ["u2", undefined]]);
  });
});
