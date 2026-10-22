import assert from "node:assert/strict";
import test from "node:test";
import { fullTime, relativeTime } from "./relative-time.ts";

test("formats the sidebar hover time", () => {
  const now = new Date(2026, 9, 22, 15, 0);
  assert.equal(relativeTime(new Date(2026, 9, 22, 14, 55), now), "5 分钟前");
  assert.equal(relativeTime(new Date(2026, 9, 21, 23, 0), now), "昨天");
  assert.equal(relativeTime(new Date(2026, 8, 1, 9, 0), now), "9月1日");
  assert.equal(fullTime(new Date(2026, 9, 21, 14, 3), now), "10月21日 14:03");
});
