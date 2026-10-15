import { describe, expect, it } from "vitest";
import { navigationNodes, navigationWindow } from "./conversation-navigation";
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
      { id: "u1", preview: "第一行 第二行" },
      { id: "u2", preview: "图片消息" },
    ]);
  });

  it("points generation records at their card, with the prompt as preview", () => {
    const nodes = navigationNodes([
      message("u1", "user", "海边的灯塔"),
      { ...message("v1", "assistant", ""), replyTo: "u1", taskId: "tz.task_1", status: "processing" },
      message("u2", "user", "提交失败的提示词"),
    ]);
    expect(nodes).toEqual([
      { id: "v1", preview: "海边的灯塔" },
      { id: "u2", preview: "提交失败的提示词" },
    ]);
  });

  it("keeps a bounded window centered near the active turn", () => {
    const nodes = Array.from({ length: 12 }, (_, index) => ({
      id: `u${index}`, preview: `问题 ${index}`,
    }));
    expect(navigationWindow(nodes, 6, 7).map((node) => node.id))
      .toEqual(["u3", "u4", "u5", "u6", "u7", "u8", "u9"]);
    expect(navigationWindow(nodes, 11, 7).map((node) => node.id))
      .toEqual(["u5", "u6", "u7", "u8", "u9", "u10", "u11"]);
  });
});
