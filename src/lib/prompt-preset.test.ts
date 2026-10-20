import { describe, expect, it } from "vitest";
import { applyPromptPreset, parsePromptPreset, presetActive } from "./prompt-preset";

const preset = (prefix: string, suffix: string, enabled = true) => ({ enabled, prefix, suffix });

describe("prompt preset", () => {
  it("adds the prefix and suffix around the prompt with a comma when needed", () => {
    expect(applyPromptPreset("一只猫在草地上奔跑", preset("电影感画面", "8K 超高清"))).toBe("电影感画面，一只猫在草地上奔跑，8K 超高清");
    expect(applyPromptPreset("一只猫。", preset("电影感：", "高清"))).toBe("电影感：一只猫。高清");
    expect(applyPromptPreset("  一只猫  ", preset("", "高清"))).toBe("一只猫，高清");
  });

  it("does nothing when turned off or empty", () => {
    expect(applyPromptPreset("一只猫", preset("电影感", "高清", false))).toBe("一只猫");
    expect(applyPromptPreset("一只猫", preset("  ", ""))).toBe("一只猫");
    expect(presetActive(preset("", " "))).toBe(false);
  });

  it("doesn't add them twice when a prompt is re-edited and sent again", () => {
    const once = applyPromptPreset("一只猫", preset("电影感", "高清"));
    expect(applyPromptPreset(once, preset("电影感", "高清"))).toBe(once);
  });

  it("still works with only a preset and no typed prompt", () => {
    expect(applyPromptPreset("", preset("电影感", "高清"))).toBe("电影感，高清");
  });

  it("parses stored values defensively", () => {
    expect(parsePromptPreset(null)).toEqual({ enabled: true, prefix: "", suffix: "" });
    expect(parsePromptPreset({ enabled: false, prefix: "a", suffix: 3 })).toEqual({ enabled: false, prefix: "a", suffix: "" });
  });
});
