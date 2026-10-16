import { MY_PROMPTS, PROMPT_CATEGORIES, searchPrompts, type PromptTemplate } from "./prompt-library";

/**
 * 提示词库的个人布局:自定义分组、分类和卡片的顺序、隐藏的内置分类/提示词、
 * 卡片挪到哪个分类、使用次数和排序方式。每个用户一份(data/users/<用户ID>/prompt-library.json)。
 * 这里只放纯函数,浏览器和服务端都用。
 */
export type PromptSort = "manual" | "recent" | "frequent" | "added" | "name";
export const PROMPT_SORTS: { id: PromptSort; name: string }[] = [
  { id: "manual", name: "手动排序" },
  { id: "recent", name: "最近使用" },
  { id: "frequent", name: "最常使用" },
  { id: "added", name: "添加时间" },
  { id: "name", name: "名称" },
];

export interface PromptGroup { id: string; name: string }
export interface PromptUsage { count: number; lastUsedAt: string }

export interface PromptLayout {
  groups: PromptGroup[];
  /** 左侧分类的顺序(我的提示词、内置分类、自定义分组的 ID 混排) */
  categoryOrder: string[];
  /** 删除的内置分类(可恢复) */
  hiddenCategories: string[];
  /** 删除的内置提示词(可恢复) */
  hiddenPrompts: string[];
  /** 手动排序时卡片的先后 */
  promptOrder: string[];
  /** 拖到别的分类的卡片:提示词 ID → 分类 ID */
  placement: Record<string, string>;
  usage: Record<string, PromptUsage>;
  sort: PromptSort;
}

export const emptyPromptLayout = (): PromptLayout => ({
  groups: [], categoryOrder: [], hiddenCategories: [], hiddenPrompts: [], promptOrder: [], placement: {}, usage: {},
  sort: "manual",
});

export type CategoryKind = "mine" | "builtin" | "group";
export interface LibraryCategory { id: string; name: string; kind: CategoryKind }

/** 所有分类(含隐藏的),按用户的顺序;没排过的按默认顺序接在后面 */
function allCategories(layout: PromptLayout): LibraryCategory[] {
  const defaults: LibraryCategory[] = [
    { id: MY_PROMPTS.id, name: MY_PROMPTS.name, kind: "mine" },
    ...PROMPT_CATEGORIES.map((item) => ({ id: item.id, name: item.name, kind: "builtin" as const })),
    ...layout.groups.map((group) => ({ id: group.id, name: group.name, kind: "group" as const })),
  ];
  const byId = new Map(defaults.map((item) => [item.id, item]));
  const ordered = layout.categoryOrder.flatMap((id) => byId.get(id) ? [byId.get(id)!] : []);
  const seen = new Set(ordered.map((item) => item.id));
  return [...ordered, ...defaults.filter((item) => !seen.has(item.id))];
}

export const visibleCategories = (layout: PromptLayout) =>
  allCategories(layout).filter((item) => !layout.hiddenCategories.includes(item.id));

export const hiddenCategoryList = (layout: PromptLayout) =>
  allCategories(layout).filter((item) => layout.hiddenCategories.includes(item.id));

/** 卡片当前所在的分类:挪过且目标分类还在就用挪到的,否则用原分类 */
export function categoryOf(template: PromptTemplate, layout: PromptLayout) {
  const target = layout.placement[template.id];
  if (target && allCategories(layout).some((item) => item.id === target)) return target;
  return template.category;
}

/** 卡片是否被隐藏:本身删了,或所在分类删了 */
export const isPromptHidden = (template: PromptTemplate, layout: PromptLayout) =>
  layout.hiddenPrompts.includes(template.id) || layout.hiddenCategories.includes(categoryOf(template, layout));

/** 手动顺序:没排过的自定义提示词(最新的在前)放最前,内置的接在最后 */
export function manualOrder(templates: PromptTemplate[], layout: PromptLayout) {
  const byId = new Map(templates.map((item) => [item.id, item]));
  const ordered = layout.promptOrder.flatMap((id) => byId.get(id) ? [byId.get(id)!] : []);
  const seen = new Set(ordered.map((item) => item.id));
  const rest = templates.filter((item) => !seen.has(item.id));
  return [...rest.filter((item) => item.category === MY_PROMPTS.id), ...ordered,
    ...rest.filter((item) => item.category !== MY_PROMPTS.id)];
}

const timeOf = (iso?: string) => (iso ? new Date(iso).getTime() || 0 : 0);
type Dated = PromptTemplate & { createdAt?: string };

/** 按排序方式排好;同分时保持手动顺序 */
export function sortPrompts(templates: PromptTemplate[], layout: PromptLayout, sort = layout.sort) {
  const base = manualOrder(templates, layout);
  if (sort === "manual") return base;
  const rank = new Map(base.map((item, index) => [item.id, index]));
  const usage = (item: PromptTemplate) => layout.usage[item.id];
  const compare: Record<Exclude<PromptSort, "manual">, (a: Dated, b: Dated) => number> = {
    recent: (a, b) => timeOf(usage(b)?.lastUsedAt) - timeOf(usage(a)?.lastUsedAt),
    frequent: (a, b) => (usage(b)?.count || 0) - (usage(a)?.count || 0),
    // 内置提示词没有添加时间,排在自定义的后面
    added: (a, b) => timeOf(b.createdAt) - timeOf(a.createdAt),
    name: (a, b) => a.title.localeCompare(b.title, "zh-CN"),
  };
  return [...base].sort((a, b) => compare[sort](a, b) || rank.get(a.id)! - rank.get(b.id)!);
}

export type LibraryFilter = "all" | "hidden" | string;

/** 当前分类 + 关键词下要显示的卡片(「已隐藏」只列隐藏的) */
export function arrangePrompts(templates: PromptTemplate[], layout: PromptLayout, category: LibraryFilter, query: string) {
  const matched = searchPrompts(query, "all", templates);
  const visible = matched.filter((item) => category === "hidden" ? isPromptHidden(item, layout) : !isPromptHidden(item, layout));
  const inCategory = category === "all" || category === "hidden" ? visible
    : visible.filter((item) => categoryOf(item, layout) === category);
  return sortPrompts(inCategory, layout);
}

/** 每个分类(含「全部」「已隐藏」)在当前关键词下的数量 */
export function categoryCounts(templates: PromptTemplate[], layout: PromptLayout, query: string) {
  const counts: Record<string, number> = { all: 0, hidden: 0 };
  for (const item of searchPrompts(query, "all", templates)) {
    if (isPromptHidden(item, layout)) { counts.hidden += 1; continue; }
    counts.all += 1;
    const category = categoryOf(item, layout);
    counts[category] = (counts[category] || 0) + 1;
  }
  return counts;
}

/** 把卡片挪到某个分类;挪回原分类时去掉记录 */
export function movePrompts(layout: PromptLayout, templates: PromptTemplate[], ids: string[], categoryId: string): PromptLayout {
  const placement = { ...layout.placement };
  const byId = new Map(templates.map((item) => [item.id, item]));
  for (const id of ids) {
    if (byId.get(id)?.category === categoryId) delete placement[id];
    else placement[id] = categoryId;
  }
  return { ...layout, placement };
}

/** 把一组卡片拖到 targetId 前面(after 时放后面),得到新的手动顺序 */
export function reorderPrompts(layout: PromptLayout, templates: PromptTemplate[], ids: string[], targetId: string, after = false) {
  if (ids.includes(targetId)) return layout;
  const moving = new Set(ids);
  const order = manualOrder(templates, layout).map((item) => item.id);
  const kept = order.filter((id) => !moving.has(id));
  const index = kept.indexOf(targetId);
  if (index < 0) return layout;
  const dragged = order.filter((id) => moving.has(id));
  kept.splice(after ? index + 1 : index, 0, ...dragged);
  return { ...layout, promptOrder: kept };
}

export function reorderCategories(layout: PromptLayout, id: string, targetId: string, after = false): PromptLayout {
  if (id === targetId) return layout;
  const order = allCategories(layout).map((item) => item.id).filter((item) => item !== id);
  const index = order.indexOf(targetId);
  if (index < 0) return layout;
  order.splice(after ? index + 1 : index, 0, id);
  return { ...layout, categoryOrder: order };
}

export const MAX_PROMPT_GROUPS = 50;

export function addPromptGroup(layout: PromptLayout, name: string, id = `grp-${crypto.randomUUID().slice(0, 8)}`) {
  const trimmed = name.trim().slice(0, 20);
  if (!trimmed) throw new Error("分组名称不能为空");
  if (layout.groups.length >= MAX_PROMPT_GROUPS) throw new Error(`最多 ${MAX_PROMPT_GROUPS} 个分组`);
  return { layout: { ...layout, groups: [...layout.groups, { id, name: trimmed }] }, id };
}

export function renamePromptGroup(layout: PromptLayout, id: string, name: string): PromptLayout {
  const trimmed = name.trim().slice(0, 20);
  if (!trimmed) return layout;
  return { ...layout, groups: layout.groups.map((group) => group.id === id ? { ...group, name: trimmed } : group) };
}

/** 删除分类:自定义分组直接删掉(里面的卡片回到原分类),内置分类隐藏;「我的提示词」不能删 */
export function removeCategories(layout: PromptLayout, ids: string[]): PromptLayout {
  const groupIds = new Set(layout.groups.map((group) => group.id));
  const builtin = new Set<string>(PROMPT_CATEGORIES.map((item) => item.id));
  const removedGroups = new Set(ids.filter((id) => groupIds.has(id)));
  const hidden = ids.filter((id) => builtin.has(id));
  return {
    ...layout,
    groups: layout.groups.filter((group) => !removedGroups.has(group.id)),
    categoryOrder: layout.categoryOrder.filter((id) => !removedGroups.has(id)),
    hiddenCategories: [...new Set([...layout.hiddenCategories, ...hidden])],
    placement: Object.fromEntries(Object.entries(layout.placement).filter(([, target]) => !removedGroups.has(target))),
  };
}

export const restoreCategories = (layout: PromptLayout, ids: string[]): PromptLayout =>
  ({ ...layout, hiddenCategories: layout.hiddenCategories.filter((id) => !ids.includes(id)) });

export const hidePrompts = (layout: PromptLayout, ids: string[]): PromptLayout =>
  ({ ...layout, hiddenPrompts: [...new Set([...layout.hiddenPrompts, ...ids])] });

/** 恢复卡片;所在分类也被删了的话一起恢复,不然还是看不到 */
export function restorePrompts(layout: PromptLayout, templates: PromptTemplate[], ids: string[]): PromptLayout {
  const byId = new Map(templates.map((item) => [item.id, item]));
  const categories = ids.flatMap((id) => byId.get(id) ? [categoryOf(byId.get(id)!, layout)] : []);
  return restoreCategories({ ...layout, hiddenPrompts: layout.hiddenPrompts.filter((id) => !ids.includes(id)) }, categories);
}

/** 记一次使用 */
export function recordUsage(layout: PromptLayout, id: string, at = new Date().toISOString()): PromptLayout {
  const current = layout.usage[id];
  return { ...layout, usage: { ...layout.usage, [id]: { count: (current?.count || 0) + 1, lastUsedAt: at } } };
}
