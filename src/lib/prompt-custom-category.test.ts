import { describe, expect, it } from "vitest";
import { PROMPT_TEMPLATES } from "./prompt-library";
import {
  addPromptCategory, addPromptGroup, arrangePrompts, categoryCounts, categoryTree, emptyPromptLayout, movePrompts,
  normalizePromptLayout, removeCategories, renamePromptGroup, reorderCategories, type PromptLayout,
} from "./prompt-layout";

describe("custom prompt categories", () => {
  const group = addPromptGroup(emptyPromptLayout(), "GPT质量提示词", "grp-top");
  const created = addPromptCategory(group.layout, "不烦不烦", "grp-top", "cat-a");
  const top = (layout: PromptLayout) => categoryTree(layout).map((node) => node.category.id);

  it("creates a plain category inside the group", () => {
    const node = categoryTree(created.layout).find((item) => item.category.id === "grp-top");
    expect(node?.children.map((item) => [item.id, item.kind])).toContainEqual(["cat-a", "custom"]);
    expect(top(created.layout)).not.toContain("cat-a");
  });

  it("holds prompts, counted under the group too", () => {
    const prompt = PROMPT_TEMPLATES[0];
    const layout = movePrompts(created.layout, PROMPT_TEMPLATES, [prompt.id], "cat-a");
    expect(categoryCounts(PROMPT_TEMPLATES, layout, "")).toMatchObject({ "cat-a": 1, "grp-top": 1 });
    expect(arrangePrompts(PROMPT_TEMPLATES, layout, "cat-a", "").map((item) => item.id)).toEqual([prompt.id]);
    // 删掉分类:卡片回到原来的分类
    const removed = removeCategories(layout, ["cat-a"]);
    expect(removed.categories).toEqual([]);
    expect(removed.placement[prompt.id]).toBeUndefined();
  });

  it("can be dragged out of the group and renamed", () => {
    const outside = reorderCategories(created.layout, "cat-a", "mine");
    expect(top(outside)).toContain("cat-a");
    expect(renamePromptGroup(created.layout, "cat-a", "新名字").categories?.[0].name).toBe("新名字");
  });

  it("turns old nested groups into categories", () => {
    const old = { ...group.layout, groups: [...group.layout.groups, { id: "grp-old", name: "旧" }], parents: { "grp-old": "grp-top" } };
    const fixed = normalizePromptLayout(old);
    expect(fixed.groups.map((item) => item.id)).toEqual(["grp-top"]);
    expect(fixed.categories).toEqual([{ id: "grp-old", name: "旧" }]);
    expect(categoryTree(fixed).find((item) => item.category.id === "grp-top")?.children.map((item) => item.id)).toEqual(["grp-old"]);
  });
});
