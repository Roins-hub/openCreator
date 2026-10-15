import { describe, expect, it } from "vitest";
import { taskElapsedMs } from "./tangzhi-server";
import { formatDate, formatDuration } from "@/components/video-task-card";

describe("taskElapsedMs", () => {
  it("uses the relay's created_at / completed_at seconds", () => {
    expect(taskElapsedMs({ created_at: 1791989327, completed_at: 1791993066 })).toBe(3_739_000);
  });

  it("accepts millisecond timestamps", () => {
    expect(taskElapsedMs({ created_at: 1791989327000, completed_at: 1791989387000 })).toBe(60_000);
  });

  it("is empty without both timestamps or when they are reversed", () => {
    expect(taskElapsedMs({ created_at: 1791989327 })).toBeUndefined();
    expect(taskElapsedMs({ created_at: 20, completed_at: 10 })).toBeUndefined();
    expect(taskElapsedMs({ created_at: 0, completed_at: 10 })).toBeUndefined();
  });
});

describe("formatDuration", () => {
  it("formats seconds, minutes and hours", () => {
    expect(formatDuration(45_000)).toBe("45秒");
    expect(formatDuration(754_000)).toBe("12分34秒");
    expect(formatDuration(120_000)).toBe("2分");
    expect(formatDuration(3_739_000)).toBe("1小时2分");
    expect(formatDuration(7_200_000)).toBe("2小时");
  });
});

describe("formatDate", () => {
  const now = new Date(2026, 9, 15, 12, 0);
  it("omits the year for this year's dates", () => {
    expect(formatDate(new Date(2026, 9, 14, 21, 5).toISOString(), now)).toBe("10月14日 21:05");
  });
  it("keeps the year for older dates and ignores invalid ones", () => {
    expect(formatDate(new Date(2025, 0, 3, 8, 30).toISOString(), now)).toBe("2025年1月3日 08:30");
    expect(formatDate("not a date", now)).toBe("");
  });
});
