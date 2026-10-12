import { describe, expect, it } from "vitest";
import { matchAsset } from "./asset-library";

describe("asset search", () => {
  const asset = { prompt: "雨夜的狭窄小巷，霓虹招牌倒映在积水里", conversationTitle: "雨夜追逐", name: "mote-2026-10-12-abc.mp4" };
  it("matches prompt, conversation title and file name; every word must hit", () => {
    expect(matchAsset(asset, "霓虹")).toBe(true);
    expect(matchAsset(asset, "追逐")).toBe(true);
    expect(matchAsset(asset, "2026-10-12")).toBe(true);
    expect(matchAsset(asset, "雨夜 霓虹")).toBe(true);
    expect(matchAsset(asset, "雨夜 沙漠")).toBe(false);
    expect(matchAsset(asset, "  ")).toBe(true);
  });
});
