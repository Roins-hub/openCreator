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

/** 分组:像文件夹一样装分类(也可以直接放卡片);collapsed 为收起 */
export interface PromptGroup { id: string; name: string; collapsed?: boolean }
export interface PromptUsage { count: number; lastUsedAt: string }
/** 自己建的分类:和内置分类一样装卡片,可以放进分组、拖出分组 */
export interface PromptCustomCategory { id: string; name: string }

export interface PromptLayout {
  groups: PromptGroup[];
  /** 自己建的分类(旧数据没有这项) */
  categories?: PromptCustomCategory[];
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
  /** 放进分组的分类:分类 ID → 分组 ID(分组不能再放进分组) */
  parents: Record<string, string>;
  usage: Record<string, PromptUsage>;
  sort: PromptSort;
}

export const emptyPromptLayout = (): PromptLayout => ({
  groups: [], categories: [], categoryOrder: [], hiddenCategories: [], hiddenPrompts: [], promptOrder: [], placement: {}, parents: {},
  usage: {}, sort: "manual",
});

export type CategoryKind = "mine" | "builtin" | "custom" | "group";
export interface LibraryCategory { id: string; name: string; kind: CategoryKind }

/** 所有分类(含隐藏的),按用户的顺序;没排过的按默认顺序接在后面 */
function allCategories(layout: PromptLayout): LibraryCategory[] {
  const defaults: LibraryCategory[] = [
    { id: MY_PROMPTS.id, name: MY_PROMPTS.name, kind: "mine" },
    ...PROMPT_CATEGORIES.map((item) => ({ id: item.id, name: item.name, kind: "builtin" as const })),
    ...(layout.categories || []).map((item) => ({ id: item.id, name: item.name, kind: "custom" as const })),
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

const isGroupId = (layout: PromptLayout, id: string) => layout.groups.some((group) => group.id === id);

/** 分类所在的分组;分组本身、或分组已经删掉时返回 undefined */
export function parentOf(layout: PromptLayout, id: string) {
  const parent = layout.parents?.[id];
  return parent && !isGroupId(layout, id) && isGroupId(layout, parent) ? parent : undefined;
}

export interface CategoryNode { category: LibraryCategory; children: LibraryCategory[] }

/** 左侧分类树:顶层是分组和没放进分组的分类,分组下面是它装的分类(都按用户排的顺序) */
export function categoryTree(layout: PromptLayout): CategoryNode[] {
  const visible = visibleCategories(layout);
  return visible
    .filter((item) => !parentOf(layout, item.id))
    .map((category) => ({
      category,
      children: category.kind === "group" ? visible.filter((item) => parentOf(layout, item.id) === category.id) : [],
    }));
}

/** 选中某个分类时包含的分类:分组 = 它自己 + 里面所有分类 */
export function categoryScope(layout: PromptLayout, id: string) {
  const scope = new Set([id]);
  if (isGroupId(layout, id)) {
    for (const item of allCategories(layout)) if (parentOf(layout, item.id) === id) scope.add(item.id);
  }
  return scope;
}

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
  const scope = categoryScope(layout, category);
  const inCategory = category === "all" || category === "hidden" ? visible
    : visible.filter((item) => scope.has(categoryOf(item, layout)));
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
    // 分组的数量也算上里面分类的卡片
    const parent = parentOf(layout, category);
    if (parent) counts[parent] = (counts[parent] || 0) + 1;
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

/**
 * 把分类拖到 targetId 前面(after 时放后面)。分类跟着目标进出分组:目标在某个分组里就放进那个分组,
 * 目标在顶层就移到顶层;拖的是分组时只在顶层排序(目标在分组里时排到那个分组旁边)。
 */
export function reorderCategories(layout: PromptLayout, id: string, targetId: string, after = false): PromptLayout {
  if (id === targetId) return layout;
  const draggingGroup = isGroupId(layout, id);
  const target = draggingGroup ? parentOf(layout, targetId) || targetId : targetId;
  if (target === id) return layout;
  const order = allCategories(layout).map((item) => item.id).filter((item) => item !== id);
  const index = order.indexOf(target);
  if (index < 0) return layout;
  order.splice(after ? index + 1 : index, 0, id);
  const parents = { ...(layout.parents || {}) };
  if (!draggingGroup) {
    const parent = parentOf(layout, targetId);
    if (parent) parents[id] = parent;
    else delete parents[id];
  }
  return { ...layout, categoryOrder: order, parents };
}

/** 把分类放进分组(groupId 为空 = 移出分组);分组不能放进分组 */
export function nestCategories(layout: PromptLayout, ids: string[], groupId: string | undefined): PromptLayout {
  const parents = { ...(layout.parents || {}) };
  for (const id of ids) {
    if (isGroupId(layout, id) || id === groupId) continue;
    if (groupId && isGroupId(layout, groupId)) parents[id] = groupId;
    else delete parents[id];
  }
  return { ...layout, parents };
}

/** 展开 / 收起分组 */
export const toggleGroupCollapsed = (layout: PromptLayout, id: string): PromptLayout =>
  ({ ...layout, groups: layout.groups.map((group) => group.id === id ? { ...group, collapsed: !group.collapsed } : group) });

export const MAX_PROMPT_GROUPS = 50;
export const MAX_PROMPT_CATEGORIES = 100;

/** 新建分类;给了分组时建在那个分组里(并展开分组),排在分组里最上面 */
export function addPromptCategory(layout: PromptLayout, name: string, groupId?: string, id = `cat-${crypto.randomUUID().slice(0, 8)}`) {
  const trimmed = name.trim().slice(0, 20);
  if (!trimmed) throw new Error("分类名称不能为空");
  const existing = layout.categories || [];
  if (existing.length >= MAX_PROMPT_CATEGORIES) throw new Error(`最多 ${MAX_PROMPT_CATEGORIES} 个自建分类`);
  const inGroup = groupId && isGroupId(layout, groupId) ? groupId : undefined;
  const categories = [...existing, { id, name: trimmed }];
  const groups = layout.groups.map((group) => group.id === inGroup ? { ...group, collapsed: false } : group);
  const categoryOrder = [id, ...allCategories({ ...layout, categories }).map((item) => item.id).filter((item) => item !== id)];
  const parents = inGroup ? { ...(layout.parents || {}), [id]: inGroup } : layout.parents;
  return { layout: { ...layout, groups, categories, categoryOrder, parents }, id };
}

/**
 * 旧数据整理:之前分组旁的「+」建的是「分组里的分组」,现在改成在分组里建分类。
 * 放在别的分组里的分组转成普通分类(ID、名称、位置和里面的卡片都不变)。
 */
export function normalizePromptLayout(layout: PromptLayout): PromptLayout {
  const groupIds = new Set(layout.groups.map((group) => group.id));
  const nested = layout.groups.filter((group) => {
    const parent = layout.parents?.[group.id];
    return parent && parent !== group.id && groupIds.has(parent);
  });
  if (!nested.length) return layout;
  const moved = new Set(nested.map((group) => group.id));
  return {
    ...layout,
    groups: layout.groups.filter((group) => !moved.has(group.id)),
    categories: [...(layout.categories || []), ...nested.map(({ id, name }) => ({ id, name }))],
  };
}

export function addPromptGroup(layout: PromptLayout, name: string, id = `grp-${crypto.randomUUID().slice(0, 8)}`) {
  const trimmed = name.trim().slice(0, 20);
  if (!trimmed) throw new Error("分组名称不能为空");
  if (layout.groups.length >= MAX_PROMPT_GROUPS) throw new Error(`最多 ${MAX_PROMPT_GROUPS} 个分组`);
  const groups = [...layout.groups, { id, name: trimmed }];
  // 新分组排在分类列表最上面,建完马上能看到
  const categoryOrder = [id, ...allCategories({ ...layout, groups }).map((item) => item.id).filter((item) => item !== id)];
  return { layout: { ...layout, groups, categoryOrder }, id };
}

/** 重命名分组或自建分类 */
export function renamePromptGroup(layout: PromptLayout, id: string, name: string): PromptLayout {
  const trimmed = name.trim().slice(0, 20);
  if (!trimmed) return layout;
  return {
    ...layout,
    groups: layout.groups.map((group) => group.id === id ? { ...group, name: trimmed } : group),
    categories: (layout.categories || []).map((item) => item.id === id ? { ...item, name: trimmed } : item),
  };
}

/** 删除分类:分组和自建分类直接删掉(里面的卡片回到原分类),内置分类隐藏;「我的提示词」不能删 */
export function removeCategories(layout: PromptLayout, ids: string[]): PromptLayout {
  const groupIds = new Set(layout.groups.map((group) => group.id));
  const customIds = new Set((layout.categories || []).map((item) => item.id));
  const builtin = new Set<string>(PROMPT_CATEGORIES.map((item) => item.id));
  const removedGroups = new Set(ids.filter((id) => groupIds.has(id)));
  const removed = new Set(ids.filter((id) => groupIds.has(id) || customIds.has(id)));
  const hidden = ids.filter((id) => builtin.has(id));
  return {
    ...layout,
    groups: layout.groups.filter((group) => !removed.has(group.id)),
    categories: (layout.categories || []).filter((item) => !removed.has(item.id)),
    categoryOrder: layout.categoryOrder.filter((id) => !removed.has(id)),
    hiddenCategories: [...new Set([...layout.hiddenCategories, ...hidden])],
    placement: Object.fromEntries(Object.entries(layout.placement).filter(([, target]) => !removed.has(target))),
    // 删掉的分组里的分类回到顶层
    parents: Object.fromEntries(Object.entries(layout.parents || {})
      .filter(([id, group]) => !removedGroups.has(group) && !removed.has(id))),
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
