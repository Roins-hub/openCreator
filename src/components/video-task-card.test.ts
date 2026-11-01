import { describe, expect, it } from "vitest";
import { videoRatio } from "./video-task-card";

describe("videoRatio", () => {
  it("turns the requested ratio into width / height", () => {
    expect(videoRatio("9:16")).toBeCloseTo(0.5625);
    expect(videoRatio("21:9")).toBeCloseTo(21 / 9);
    expect(videoRatio("1:1")).toBe(1);
  });

  it("falls back to 16:9 for adaptive and old tasks", () => {
    expect(videoRatio("adaptive")).toBeCloseTo(16 / 9);
    expect(videoRatio(undefined)).toBeCloseTo(16 / 9);
  });
});
