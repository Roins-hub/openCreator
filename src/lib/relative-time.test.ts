import { describe, expect, it } from "vitest";
import { fullTime, relativeTime } from "./relative-time";

describe("relative time", () => {
  const now = new Date(2026, 9, 22, 15, 0);
  it("reads like the sidebar card", () => {
    expect(relativeTime(new Date(2026, 9, 22, 14, 59, 30), now)).toBe("刚刚");
    expect(relativeTime(new Date(2026, 9, 22, 14, 55), now)).toBe("5 分钟前");
    expect(relativeTime(new Date(2026, 9, 22, 11, 30), now)).toBe("3 小时前");
    expect(relativeTime(new Date(2026, 9, 21, 23, 0), now)).toBe("昨天");
    expect(relativeTime(new Date(2026, 9, 19, 9, 0), now)).toBe("3 天前");
    expect(relativeTime(new Date(2026, 8, 1, 9, 0), now)).toBe("9月1日");
    expect(relativeTime(new Date(2025, 8, 1, 9, 0), now)).toBe("2025年9月1日");
    expect(fullTime(new Date(2026, 9, 21, 14, 3), now)).toBe("10月21日 14:03");
    expect(fullTime(new Date(2025, 0, 2, 8, 5), now)).toBe("2025年1月2日 08:05");
  });
});
