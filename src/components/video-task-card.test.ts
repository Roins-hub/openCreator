import { describe, expect, it } from "vitest";
import { equalAreaWidth, videoPreviewLayout, videoPreviewWidth, videoRatio } from "./video-task-card";

describe("videoRatio", () => {
  it("turns the requested ratio into width / height", () => {
    expect(videoRatio("9:16")).toBeCloseTo(0.5625);
    expect(videoRatio("21:9")).toBeCloseTo(21 / 9);
    expect(videoRatio("1:1")).toBe(1);
  });

  it("falls back for adaptive, auto and old tasks", () => {
    expect(videoRatio("adaptive")).toBeCloseTo(16 / 9);
    expect(videoRatio(undefined)).toBeCloseTo(16 / 9);
    expect(videoRatio("auto", 1)).toBe(1);
  });
});

describe("equal area sizing", () => {
  it("gives portrait and landscape tiles the same area", () => {
    const area = (ratio: number) => equalAreaWidth(ratio, 210) ** 2 / ratio;
    expect(Math.abs(area(9 / 16) / area(16 / 9) - 1)).toBeLessThan(0.02);
    expect(equalAreaWidth(1, 210)).toBe(210);
  });

  it("fills the video column at 16:9 and wider, and shrinks a 9:16 preview to the same area", () => {
    expect(videoPreviewWidth(16 / 9)).toBe(1);
    expect(videoPreviewWidth(21 / 9)).toBe(1);
    expect(videoPreviewWidth(9 / 16)).toBeCloseTo(0.5625);
  });
});

describe("videoPreviewLayout", () => {
  it("puts several portrait videos in two columns at full cell width", () => {
    for (const slots of [2, 3, 4]) expect(videoPreviewLayout(slots, 9 / 16)).toEqual({ columns: 2, width: "100%" });
  });

  it("stacks landscape videos in one column", () => {
    expect(videoPreviewLayout(3, 16 / 9)).toEqual({ columns: 1, width: "100%" });
  });

  it("keeps a single video at its equal-area width", () => {
    expect(videoPreviewLayout(1, 9 / 16).columns).toBe(1);
    expect(parseFloat(videoPreviewLayout(1, 9 / 16).width)).toBeCloseTo(56.25);
  });
});
