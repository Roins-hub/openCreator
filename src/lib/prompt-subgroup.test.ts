import { describe, expect, it } from "vitest";
import { PROMPT_TEMPLATES } from "./prompt-library";
import {
  addPromptGroup, arrangePrompts, categoryCounts, categoryTree, emptyPromptLayout, movePrompts, nestCategories, removeCategories,
} from "./prompt-layout";

describe("prompt library subgroups", () => {
  const parent = addPromptGroup(emptyPromptLayout(), "GPT质量提示词", "grp-top");
  const child = addPromptGroup(parent.layout, "人像", "grp-face", "grp-top");

  it("creates a subgroup under a top-level group", () => {
    const top = categoryTree(child.layout).find((node) => node.category.id === "grp-top");
    expect(top?.children.map((item) => item.id)).toContain("grp-face");
    expect(categoryTree(child.layout).some((node) => node.category.id === "grp-face")).toBe(false);
  });

  it("counts and shows the subgroup's prompts under the parent", () => {
    const prompt = PROMPT_TEMPLATES[0];
    const layout = movePrompts(child.layout, PROMPT_TEMPLATES, [prompt.id], "grp-face");
    expect(categoryCounts(PROMPT_TEMPLATES, layout, "")).toMatchObject({ "grp-face": 1, "grp-top": 1 });
    expect(arrangePrompts(PROMPT_TEMPLATES, layout, "grp-top", "").map((item) => item.id)).toContain(prompt.id);
  });

  it("stops at two levels, can move a subgroup out, and lifts it when the parent goes", () => {
    expect(() => addPromptGroup(child.layout, "更深", "grp-deep", "grp-face")).toThrow(/子分组下不能再建/);
    const out = nestCategories(child.layout, ["grp-face"], undefined);
    expect(categoryTree(out).some((node) => node.category.id === "grp-face")).toBe(true);
    const lifted = removeCategories(child.layout, ["grp-top"]);
    expect(categoryTree(lifted).some((node) => node.category.id === "grp-face")).toBe(true);
  });
});
