import { describe, expect, it } from "vitest";
import {
  PROMPT_CATEGORIES, PROMPT_TEMPLATES, fitDuration, requiredReferences, searchPrompts,
} from "./prompt-library";
import { splitPromptReferences } from "./prompt-references";

describe("prompt library data", () => {
  it("has unique ids and every category is populated", () => {
    const ids = PROMPT_TEMPLATES.map((template) => template.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const category of PROMPT_CATEGORIES) {
      expect(PROMPT_TEMPLATES.some((template) => template.category === category.id)).toBe(true);
    }
  });

  it("only uses [图N] markers in templates that request reference images", () => {
    for (const template of PROMPT_TEMPLATES) {
      const markers = splitPromptReferences(template.prompt).filter((segment) => segment.kind === "reference");
      if (markers.length) expect(requiredReferences(template)).toBeGreaterThan(0);
    }
  });
});

describe("searchPrompts", () => {
  it("filters by category and keyword across title, prompt and tags", () => {
    expect(searchPrompts("", "food").every((template) => template.category === "food")).toBe(true);
    expect(searchPrompts("拉面").map((template) => template.id)).toContain("food-ramen");
    expect(searchPrompts("慢动作").length).toBeGreaterThan(3);
    expect(searchPrompts("不存在的关键词xyz")).toEqual([]);
  });
});

describe("fitDuration", () => {
  const presets = [3, 4, 5, 6, 7, 8, 9, 10, 15, 20, 30];
  it("keeps supported durations and clamps to the model limit", () => {
    expect(fitDuration(10, 30, presets)).toBe(10);
    expect(fitDuration(15, 10, presets)).toBe(10);
    expect(fitDuration(undefined, 10, presets)).toBeUndefined();
  });
});
