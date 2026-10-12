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

/** 整体保存(新建、重命名、排序、折叠、解散都是改这份列表) */
export async function saveGroups(userId: string, value: unknown) {
  const groups = z.array(groupSchema).max(MAX_GROUPS, `最多 ${MAX_GROUPS} 个分组`).parse(value);
  const unique = [...new Map(groups.map((group) => [group.id, group])).values()];
  await writeJsonAtomic(groupsFile(userId), unique);
  return unique;
}
