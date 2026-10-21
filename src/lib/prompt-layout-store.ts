import { resolve } from "node:path";
import { z } from "zod";
import { readJson, writeJsonAtomic } from "./json-store";
import {
  emptyPromptLayout, MAX_PROMPT_CATEGORIES, MAX_PROMPT_GROUPS, normalizePromptLayout, recordUsage, type PromptLayout,
} from "./prompt-layout";

/** 提示词库的个人布局,存在每个用户自己的目录里(root = data/users/<用户ID>)。 */
const layoutFile = (root: string) => resolve(root, "prompt-library.json");

const id = z.string().regex(/^[\w-]{1,100}$/);
const ids = z.array(id).max(2000);
const usageSchema = z.object({ count: z.number().int().nonnegative(), lastUsedAt: z.string().max(40) });

const layoutSchema = z.object({
  groups: z.array(z.object({
    id: z.string().regex(/^grp-[\w-]{1,40}$/, "分组 ID 不正确"),
    name: z.string().trim().min(1, "分组名称不能为空").max(20, "分组名称最多 20 个字"),
    collapsed: z.boolean().optional(),
  })).max(MAX_PROMPT_GROUPS, `最多 ${MAX_PROMPT_GROUPS} 个分组`),
  categories: z.array(z.object({
    // 旧数据里由「分组里的分组」转来的分类保留原来的 grp- ID
    id: z.string().regex(/^(cat|grp)-[\w-]{1,40}$/, "分类 ID 不正确"),
    name: z.string().trim().min(1, "分类名称不能为空").max(20, "分类名称最多 20 个字"),
  })).max(MAX_PROMPT_CATEGORIES, `最多 ${MAX_PROMPT_CATEGORIES} 个自建分类`).optional(),
  categoryOrder: ids,
  hiddenCategories: ids,
  hiddenPrompts: ids,
  promptOrder: ids,
  placement: z.record(id, id).refine((value) => Object.keys(value).length <= 2000, "记录太多"),
  parents: z.record(id, id).refine((value) => Object.keys(value).length <= 500, "记录太多").optional(),
  usage: z.record(id, usageSchema).optional(),
  sort: z.enum(["manual", "recent", "frequent", "added", "name"]),
});

const queues = new Map<string, Promise<unknown>>();
/** 同一个用户的读改写排队执行,免得两个请求互相覆盖 */
function serial<T>(root: string, task: () => Promise<T>) {
  const result = (queues.get(root) || Promise.resolve()).then(task, task);
  const tail = result.catch(() => undefined);
  queues.set(root, tail);
  void tail.then(() => { if (queues.get(root) === tail) queues.delete(root); });
  return result;
}

export async function getPromptLayout(root: string): Promise<PromptLayout> {
  const parsed = layoutSchema.safeParse(await readJson<unknown>(layoutFile(root), null));
  if (!parsed.success) return emptyPromptLayout();
  return normalizePromptLayout({
    ...parsed.data, usage: parsed.data.usage || {}, parents: parsed.data.parents || {},
    categories: parsed.data.categories || [],
    hiddenCategories: parsed.data.hiddenCategories.filter((item) => item !== "mine"),
  });
}

/** 整体保存布局;使用次数以服务端记的为准,不被页面上的旧数据覆盖 */
export async function savePromptLayout(root: string, value: unknown) {
  const data = layoutSchema.parse(value);
  return serial(root, async () => {
    const current = await getPromptLayout(root);
    const groups = [...new Map(data.groups.map((group) => [group.id, group])).values()];
    const categories = [...new Map((data.categories || []).map((item) => [item.id, item])).values()]
      .filter((item) => !groups.some((group) => group.id === item.id));
    const next: PromptLayout = {
      ...data, groups, categories, usage: current.usage, parents: data.parents || {},
      hiddenCategories: [...new Set(data.hiddenCategories)].filter((item) => item !== "mine"),
      hiddenPrompts: [...new Set(data.hiddenPrompts)],
      categoryOrder: [...new Set(data.categoryOrder)],
      promptOrder: [...new Set(data.promptOrder)],
    };
    await writeJsonAtomic(layoutFile(root), next);
    return next;
  });
}

/** 使用一次提示词,记次数和时间 */
export async function recordPromptUse(root: string, promptId: string) {
  const parsedId = id.parse(promptId);
  return serial(root, async () => {
    const next = recordUsage(await getPromptLayout(root), parsedId);
    const usage = Object.entries(next.usage);
    // 只留最近用过的 2000 条
    if (usage.length > 2000) {
      next.usage = Object.fromEntries(usage.sort(([, a], [, b]) => b.lastUsedAt.localeCompare(a.lastUsedAt)).slice(0, 2000));
    }
    await writeJsonAtomic(layoutFile(root), next);
    return next.usage[parsedId];
  });
}
