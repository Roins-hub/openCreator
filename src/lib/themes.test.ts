import { describe, expect, it } from "vitest";
import { THEMES, parseThemeMode, resolveTheme, themeBootScript } from "./themes";

describe("themes", () => {
  it("resolves system mode by color scheme preference", () => {
    expect(resolveTheme("system", false)).toBe("paper");
    expect(resolveTheme("system", true)).toBe("graphite");
    expect(resolveTheme("celadon", true)).toBe("celadon");
  });

  it("falls back to system for unknown stored values", () => {
    expect(parseThemeMode("midnight")).toBe("midnight");
    expect(parseThemeMode("vaporwave")).toBe("system");
    expect(parseThemeMode(null)).toBe("system");
  });

  it("boot script knows every theme id", () => {
    for (const theme of THEMES) expect(themeBootScript).toContain(`"${theme.id}"`);
  });
});
