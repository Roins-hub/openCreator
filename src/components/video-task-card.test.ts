import { describe, expect, it } from "vitest";
import { equalAreaWidth, videoPreviewWidth, videoRatio } from "./video-task-card";

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
