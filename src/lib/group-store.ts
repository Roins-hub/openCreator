import { z } from "zod";
import { inside } from "./paths";
import { userDir } from "./identity";
import { readJson, writeJsonAtomic } from "./json-store";

/** 侧边栏的对话分组,每个用户一份:data/users/<用户ID>/groups.json(对话通过 groupId 归组)。 */
export const MAX_GROUPS = 50;

export const groupSchema = z.object({
  id: z.string().regex(/^[\w-]{1,80}$/, "分组 ID 不正确"),
  name: z.string().trim().min(1, "分组名称不能为空").max(30, "分组名称最多 30 个字"),
  collapsed: z.boolean().optional(),
});
export type ConversationGroup = z.infer<typeof groupSchema>;

const groupsFile = (userId: string) => inside(userDir(userId), "groups.json");

export async function listGroups(userId: string): Promise<ConversationGroup[]> {
  const value = await readJson<unknown>(groupsFile(userId), []);
  const parsed = z.array(groupSchema).safeParse(value);
  return parsed.success ? parsed.data : [];
}

// 同一用户的保存按顺序执行,两台设备同时保存也不会互相覆盖
const queues = new Map<string, Promise<unknown>>();
function serial<T>(userId: string, task: () => Promise<T>) {
  const result = (queues.get(userId) || Promise.resolve()).then(task, task);
  const tail = result.catch(() => undefined);
  queues.set(userId, tail);
  void tail.then(() => { if (queues.get(userId) === tail) queues.delete(userId); });
  return result;
}

const saveSchema = z.object({
  groups: z.array(groupSchema),
  /** 这台设备知道的分组 ID:只有这些分组会被它改动或删除 */
  known: z.array(z.string().max(80)).max(500),
});

/**
 * 合并:这台设备给出的分组(新建、重命名、排序、折叠的结果)为准;
 * 它不知道的分组(别的设备刚建的)原样保留,不会因为这台设备的页面没刷新就被删掉。
 */
export function mergeGroups(current: ConversationGroup[], groups: ConversationGroup[], known: readonly string[]) {
  const knownIds = new Set([...known, ...groups.map((group) => group.id)]);
  const others = current.filter((group) => !knownIds.has(group.id));
  return [...new Map([...others, ...groups].map((group) => [group.id, group])).values()];
}

/**
 * 保存分组。新版页面传 { groups, known } 合并保存;旧页面直接传数组时整体替换(兼容)。
 */
export async function saveGroups(userId: string, value: unknown) {
  return serial(userId, async () => {
    const input = Array.isArray(value) ? { groups: value, known: undefined } : saveSchema.parse(value);
    const groups = z.array(groupSchema).parse(input.groups);
    const merged = input.known ? mergeGroups(await listGroups(userId), groups, input.known)
      : [...new Map(groups.map((group) => [group.id, group])).values()];
    if (merged.length > MAX_GROUPS) throw new Error(`最多 ${MAX_GROUPS} 个分组`);
    await writeJsonAtomic(groupsFile(userId), merged);
    return merged;
  });
}
