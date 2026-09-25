"use client";

import { useEffect } from "react";
import { THEME_STORAGE_KEY, applyThemeMode, readThemeMode } from "@/lib/themes";
import { HOST_THEME_KEYS, clampHostScale, hostThemeToMote, isEmbedded, onHostMessage } from "@/lib/host-bridge";

/**
 * 独立运行:「跟随系统」时响应系统深浅色切换,多个标签页之间同步主题。
 * 嵌入 Infinite-Canvas:主题与界面缩放完全跟随宿主。
 */
export function ThemeWatcher() {
  useEffect(() => {
    const root = document.documentElement;
    if (isEmbedded()) {
      const stopHost = onHostMessage((data) => {
        if (data.type === "studio-theme") root.dataset.theme = hostThemeToMote(data.theme);
        if (data.type === "studio-ui-scale") {
          const scale = clampHostScale(data.scale);
          if (scale) root.style.setProperty("--mote-zoom", String(scale));
        }
      });
      const onStorage = (event: StorageEvent) => {
        if (event.key && (HOST_THEME_KEYS as readonly string[]).includes(event.key)) {
          root.dataset.theme = hostThemeToMote(event.newValue);
        }
      };
      window.addEventListener("storage", onStorage);
      return () => {
        stopHost();
        window.removeEventListener("storage", onStorage);
      };
    }

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
