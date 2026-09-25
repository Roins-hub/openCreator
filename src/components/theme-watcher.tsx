"use client";

import { useEffect } from "react";
import { THEME_STORAGE_KEY, applyThemeMode, readThemeMode } from "@/lib/themes";

/** 「跟随系统」时响应系统深浅色切换;多个标签页之间同步主题。 */
export function ThemeWatcher() {
  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const onSystemChange = () => {
      if (readThemeMode() === "system") applyThemeMode("system");
    };
    const onStorage = (event: StorageEvent) => {
      if (event.key === THEME_STORAGE_KEY) applyThemeMode(readThemeMode());
    };
    media.addEventListener("change", onSystemChange);
    window.addEventListener("storage", onStorage);
    return () => {
      media.removeEventListener("change", onSystemChange);
      window.removeEventListener("storage", onStorage);
    };
  }, []);
  return null;
}
