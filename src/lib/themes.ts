export const THEME_STORAGE_KEY = "mote-theme";

export type ThemeId = "paper" | "celadon" | "mist" | "graphite" | "midnight";
export type ThemeMode = ThemeId | "system";

export interface ThemeInfo {
  id: ThemeId;
  name: string;
  tagline: string;
  dark: boolean;
}

export const THEMES: ThemeInfo[] = [
  { id: "paper", name: "米白", tagline: "温润纸感，默认", dark: false },
  { id: "celadon", name: "青瓷", tagline: "淡青釉色，清爽安静", dark: false },
  { id: "mist", name: "雾蓝", tagline: "冷调灰蓝，专注理性", dark: false },
  { id: "graphite", name: "石墨", tagline: "中性深灰，夜间护眼", dark: true },
  { id: "midnight", name: "夜幕", tagline: "深靛夜色，影院氛围", dark: true },
];

const themeIds = new Set<string>(THEMES.map((theme) => theme.id));

export function parseThemeMode(value: unknown): ThemeMode {
  return typeof value === "string" && (value === "system" || themeIds.has(value)) ? value as ThemeMode : "system";
}

export function resolveTheme(mode: ThemeMode, prefersDark: boolean): ThemeId {
  if (mode !== "system") return mode;
  return prefersDark ? "graphite" : "paper";
}

/** 在首帧绘制前执行,避免刷新时先闪一下默认主题。 */
export const themeBootScript = `(function(){try{var ids=${JSON.stringify([...themeIds])};var m=localStorage.getItem("${THEME_STORAGE_KEY}");if(m!=="system"&&ids.indexOf(m)<0)m="system";var t=m==="system"?(matchMedia("(prefers-color-scheme: dark)").matches?"graphite":"paper"):m;var r=document.documentElement;r.dataset.theme=t;r.dataset.themeMode=m;}catch(e){}})();`;

export function readThemeMode(): ThemeMode {
  try { return parseThemeMode(window.localStorage.getItem(THEME_STORAGE_KEY)); } catch { return "system"; }
}

export function applyThemeMode(mode: ThemeMode) {
  const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  const root = document.documentElement;
  root.dataset.theme = resolveTheme(mode, prefersDark);
  root.dataset.themeMode = mode;
}

export function saveThemeMode(mode: ThemeMode) {
  try { window.localStorage.setItem(THEME_STORAGE_KEY, mode); } catch { /* 隐私模式下仅本次生效 */ }
  applyThemeMode(mode);
  window.dispatchEvent(new CustomEvent("mote-theme-change", { detail: mode }));
}
