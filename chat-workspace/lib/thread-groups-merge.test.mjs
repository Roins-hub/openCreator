import { test } from "node:test";
import assert from "node:assert/strict";
import { mergeThreadGroups } from "./thread-groups-merge.ts";

const g = (id) => ({ id, name: id });

test("keeps groups and moves another device made", () => {
  // 服务器上:另一台设备新建了 cat,并把 t2 移了进去
  const latest = { groups: [g("cat"), g("a")], assign: { t1: "a", t2: "cat" } };
  // 这台设备只知道 a,刚把 t3 放进 a、把 a 折叠了
  const mine = { groups: [{ ...g("a"), collapsed: true }], assign: { t1: "a", t3: "a" } };
  const merged = mergeThreadGroups(latest, mine, new Set(["a"]), new Set(["t3"]));
  assert.deepEqual(merged.groups, [g("cat"), { ...g("a"), collapsed: true }]);
  assert.deepEqual(merged.assign, { t1: "a", t2: "cat", t3: "a" });
});

test("deleting a known group drops its assignments", () => {
  const latest = { groups: [g("a"), g("b")], assign: { t1: "a", t2: "b" } };
  const mine = { groups: [g("b")], assign: { t2: "b" } };
  assert.deepEqual(mergeThreadGroups(latest, mine, new Set(["a", "b"]), new Set(["t1"])), { groups: [g("b")], assign: { t2: "b" } });
});
