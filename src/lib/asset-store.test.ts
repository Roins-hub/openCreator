import { describe, expect, it } from "vitest";
import { enrichAssets, isExpired, type AssetRecord } from "./asset-store";
import type { Conversation } from "./types";

const user = "0123456789abcdef0123456789abcdef";
const record = (name: string, createdAt: string, patch: Partial<AssetRecord> = {}): AssetRecord => ({
  kind: "video", path: `users/${user}/videos/${name}`, name, mimeType: "video/mp4", size: 5, createdAt, ...patch,
});

describe("asset store", () => {
  const conversations: Conversation[] = [{
    id: "conversation-1", title: "雨夜列车",
    createdAt: "2026-07-23T00:00:00.000Z", updatedAt: "2026-07-23T00:01:00.000Z", messages: [],
  }];

  it("adds conversation titles and favorite flags", () => {
    const assets = enrichAssets([
      record("one.mp4", "2026-07-23T00:01:00.000Z", { conversationId: "conversation-1" }),
      record("two.mp4", "2026-07-23T00:02:00.000Z", { conversationId: "deleted" }),
    ], conversations, [`users/${user}/videos/one.mp4`]);
    expect(assets.find((asset) => asset.name === "one.mp4")).toMatchObject({
      conversationId: "conversation-1", conversationTitle: "雨夜列车", favorite: true,
    });
    // 来源对话已删除:保留资产,但不再链接到对话
    expect(assets.find((asset) => asset.name === "two.mp4")).toMatchObject({ conversationId: undefined, favorite: false });
  });

  it("sorts newest first", () => {
    const assets = enrichAssets([
      record("old.mp4", "2026-07-23T00:00:00.000Z"), record("new.mp4", "2026-07-23T00:01:00.000Z"),
    ], []);
    expect(assets.map((asset) => asset.name)).toEqual(["new.mp4", "old.mp4"]);
  });

  it("hides records older than the retention period", () => {
    const now = new Date("2026-09-30T00:00:00.000Z").getTime();
    expect(isExpired({ createdAt: "2026-06-01T00:00:00.000Z" }, 90, now)).toBe(true);
    expect(isExpired({ createdAt: "2026-09-01T00:00:00.000Z" }, 90, now)).toBe(false);
    expect(isExpired({ createdAt: "2020-01-01T00:00:00.000Z" }, undefined, now)).toBe(false);
  });
});
