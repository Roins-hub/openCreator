import type { ThreadGroups } from "./thread-groups";

/** 把这台设备的改动叠到服务器上最新的一份上 */
export function mergeThreadGroups(latest: ThreadGroups, mine: ThreadGroups, known: ReadonlySet<string>, touched: ReadonlySet<string>): ThreadGroups {
  const mineIds = new Set(mine.groups.map((group) => group.id));
  const others = latest.groups.filter((group) => !known.has(group.id) && !mineIds.has(group.id));
  const groups = [...others, ...mine.groups];
  const valid = new Set(groups.map((group) => group.id));
  const assign: Record<string, string> = { ...latest.assign };
  for (const id of touched) {
    if (mine.assign[id]) assign[id] = mine.assign[id];
    else delete assign[id];
  }
  return { groups, assign: Object.fromEntries(Object.entries(assign).filter(([, groupId]) => valid.has(groupId))) };
}
