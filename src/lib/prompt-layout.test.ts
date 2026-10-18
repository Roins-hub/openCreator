import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PROMPT_TEMPLATES, type PromptTemplate } from "./prompt-library";
import {
  addPromptGroup, arrangePrompts, categoryCounts, categoryTree, emptyPromptLayout, hidePrompts, manualOrder, movePrompts,
  nestCategories, toggleGroupCollapsed,
  recordUsage, removeCategories, reorderCategories, reorderPrompts, restorePrompts, sortPrompts, visibleCategories,
} from "./prompt-layout";
import { getPromptLayout, recordPromptUse, savePromptLayout } from "./prompt-layout-store";

const mine = (id: string, title: string, createdAt: string) =>
  ({ id, category: "mine", title, prompt: title, tags: [], createdAt }) as PromptTemplate;
const a = mine("mine-a", "乙", "2026-10-01T00:00:00Z");
const b = mine("mine-b", "甲", "2026-10-02T00:00:00Z");
const templates = [b, a, ...PROMPT_TEMPLATES];
const food = PROMPT_TEMPLATES.filter((item) => item.category === "food");

describe("prompt layout", () => {
  it("puts unsorted custom prompts first and keeps a saved manual order", () => {
    const layout = emptyPromptLayout();
    expect(manualOrder(templates, layout).slice(0, 2).map((item) => item.id)).toEqual(["mine-b", "mine-a"]);
    const moved = reorderPrompts(layout, templates, ["mine-b"], food[0].id);
    const order = manualOrder(templates, moved).map((item) => item.id);
    expect(order[0]).toBe("mine-a");
    expect(order.indexOf("mine-b")).toBe(order.indexOf(food[0].id) - 1);
    const after = reorderPrompts(moved, templates, ["mine-a"], food[0].id, true);
    const next = manualOrder(templates, after).map((item) => item.id);
    expect(next.indexOf("mine-a")).toBe(next.indexOf(food[0].id) + 1);
  });

  it("sorts by usage, added time and name", () => {
    let layout = recordUsage(emptyPromptLayout(), food[1].id, "2026-10-10T00:00:00Z");
    layout = recordUsage(layout, food[0].id, "2026-10-11T00:00:00Z");
    layout = recordUsage(layout, food[1].id, "2026-10-09T00:00:00Z");
    expect(sortPrompts(templates, layout, "recent").slice(0, 2).map((item) => item.id)).toEqual([food[0].id, food[1].id]);
    expect(sortPrompts(templates, layout, "frequent")[0].id).toBe(food[1].id);
    expect(sortPrompts(templates, layout, "added").slice(0, 2).map((item) => item.id)).toEqual(["mine-b", "mine-a"]);
    expect(sortPrompts([a, b], layout, "name").map((item) => item.title)).toEqual(["甲", "乙"]);
  });

  it("moves cards into a custom group and back when the group is deleted", () => {
    const { layout: grouped, id } = addPromptGroup(emptyPromptLayout(), " 常用 ", "grp-test");
    // 新分组排在最上面
    expect(visibleCategories(grouped)[0]).toMatchObject({ id, name: "常用", kind: "group" });
    const moved = movePrompts(grouped, templates, [a.id, food[0].id], id);
    expect(arrangePrompts(templates, moved, id, "").map((item) => item.id).sort()).toEqual([a.id, food[0].id].sort());
    expect(categoryCounts(templates, moved, "").food).toBe(food.length - 1);
    // 挪回原分类就不再记录
    expect(movePrompts(moved, templates, [food[0].id], "food").placement[food[0].id]).toBeUndefined();
    const removed = removeCategories(moved, [id]);
    expect(removed.groups).toEqual([]);
    expect(removed.placement).toEqual({});
    expect(categoryCounts(templates, removed, "").food).toBe(food.length);
  });

  it("hides built-in categories and prompts, and restores them", () => {
    const layout = removeCategories(hidePrompts(emptyPromptLayout(), [PROMPT_TEMPLATES[0].id]), ["food", "mine"]);
    expect(layout.hiddenCategories).toEqual(["food"]);
    expect(visibleCategories(layout).some((item) => item.id === "food")).toBe(false);
    const counts = categoryCounts(templates, layout, "");
    expect(counts.hidden).toBe(food.length + 1);
    expect(counts.all).toBe(templates.length - food.length - 1);
    expect(arrangePrompts(templates, layout, "hidden", "").length).toBe(food.length + 1);
    // 恢复分类里的卡片会把分类一起恢复
    const restored = restorePrompts(layout, templates, [food[0].id, PROMPT_TEMPLATES[0].id]);
    expect(restored.hiddenCategories).toEqual([]);
    expect(restored.hiddenPrompts).toEqual([]);
  });

  it("nests categories inside a group like folders", () => {
    const { layout: grouped, id } = addPromptGroup(emptyPromptLayout(), "常用", "grp-folder");
    const nested = nestCategories(grouped, ["food", "animal", id], id);
    // 分组不能放进分组
    expect(nested.parents).toEqual({ food: id, animal: id });
    const tree = categoryTree(nested);
    expect(tree[0].category.id).toBe(id);
    expect(tree[0].children.map((item) => item.id).sort()).toEqual(["animal", "food"]);
    expect(tree.some((node) => node.category.id === "food")).toBe(false);
    // 分组的数量和列表包含里面所有分类
    const counts = categoryCounts(templates, nested, "");
    const animals = PROMPT_TEMPLATES.filter((item) => item.category === "animal").length;
    expect(counts[id]).toBe(food.length + animals);
    expect(arrangePrompts(templates, nested, id, "")).toHaveLength(food.length + animals);
    // 拖到顶层的分类旁边 = 移出分组;拖到组内分类旁边 = 进组
    const out = reorderCategories(nested, "food", "cinematic");
    expect(out.parents.food).toBeUndefined();
    const back = reorderCategories(out, "food", "animal", true);
    expect(back.parents.food).toBe(id);
    // 删掉分组,里面的分类回到顶层
    expect(removeCategories(nested, [id]).parents).toEqual({});
    expect(toggleGroupCollapsed(nested, id).groups[0].collapsed).toBe(true);
  });

  it("reorders categories", () => {
    const layout = reorderCategories(emptyPromptLayout(), "food", "mine");
    expect(visibleCategories(layout).slice(0, 2).map((item) => item.id)).toEqual(["food", "mine"]);
    const after = reorderCategories(layout, "mine", "camera", true);
    expect(visibleCategories(after).at(-1)?.id).toBe("mine");
  });
});

describe("prompt layout store", () => {
  let root: string;
  beforeAll(async () => { root = await mkdtemp(join(process.env.TMP || tmpdir(), "mote-prompt-layout-")); });
  afterAll(async () => { await rm(root, { recursive: true, force: true }); });

  it("saves the layout but keeps usage counted on the server", async () => {
    expect(await getPromptLayout(root)).toEqual(emptyPromptLayout());
    await recordPromptUse(root, "food-ramen");
    await Promise.all([recordPromptUse(root, "food-ramen"), recordPromptUse(root, "mine-a")]);
    const { layout } = addPromptGroup(emptyPromptLayout(), "常用", "grp-1");
    const saved = await savePromptLayout(root, { ...layout, sort: "frequent", hiddenCategories: ["food", "mine"], usage: {} });
    expect(saved.usage["food-ramen"].count).toBe(2);
    expect(saved.usage["mine-a"].count).toBe(1);
    expect(saved.hiddenCategories).toEqual(["food"]);
    expect((await getPromptLayout(root)).groups).toEqual([{ id: "grp-1", name: "常用" }]);
  });

  it("rejects bad input", async () => {
    await expect(savePromptLayout(root, { ...emptyPromptLayout(), sort: "random" })).rejects.toThrow();
    await expect(savePromptLayout(root, { ...emptyPromptLayout(), groups: [{ id: "../x", name: "x" }] })).rejects.toThrow();
    await expect(recordPromptUse(root, "../etc")).rejects.toThrow();
  });
});
