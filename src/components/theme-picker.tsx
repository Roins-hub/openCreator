"use client";

import { useEffect, useState } from "react";
import { Check, Monitor } from "lucide-react";
import { THEMES, type ThemeId, type ThemeMode, readThemeMode, saveThemeMode } from "@/lib/themes";

/** 用目标主题自身的色板渲染一个迷你工作台,预览即真实效果。 */
function ThemeMiniature({ theme }: { theme: ThemeId }) {
  return (
    <span className="theme-mini" data-theme={theme} aria-hidden="true">
      <span className="theme-mini-side"><i /><i /><i /></span>
      <span className="theme-mini-main">
        <span className="theme-mini-card"><b /><i /><em /></span>
        <span className="theme-mini-composer"><i /><b /></span>
      </span>
    </span>
  );
}

export function ThemePicker() {
  const [mode, setMode] = useState<ThemeMode>("system");
  useEffect(() => {
    const timer = window.setTimeout(() => setMode(readThemeMode()), 0);
    const onChange = (event: Event) => setMode((event as CustomEvent<ThemeMode>).detail);
    window.addEventListener("mote-theme-change", onChange);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("mote-theme-change", onChange);
    };
  }, []);

  const choose = (next: ThemeMode) => {
    setMode(next);
    saveThemeMode(next);
  };

  return (
    <section className="settings-block" aria-labelledby="theme-heading">
      <div className="provider-number">外观</div>
      <div>
        <div className="section-head">
          <h2 id="theme-heading">主题</h2>
          <span className="theme-note">保存在当前浏览器，切换立即生效</span>
        </div>
        <div className="theme-grid" role="radiogroup" aria-label="主题">
          <button type="button" role="radio" aria-checked={mode === "system"}
            className={`theme-option ${mode === "system" ? "active" : ""}`} onClick={() => choose("system")}>
            <span className="theme-mini-split">
              <ThemeMiniature theme="paper" />
              <ThemeMiniature theme="graphite" />
            </span>
            <span className="theme-option-text">
              <strong><Monitor size={13} />跟随系统</strong>
              <small>米白 / 石墨 自动切换</small>
            </span>
            {mode === "system" && <span className="theme-check"><Check size={12} strokeWidth={3} /></span>}
          </button>
          {THEMES.map((theme) => (
            <button type="button" role="radio" aria-checked={mode === theme.id} key={theme.id}
              className={`theme-option ${mode === theme.id ? "active" : ""}`} onClick={() => choose(theme.id)}>
              <ThemeMiniature theme={theme.id} />
              <span className="theme-option-text">
                <strong>{theme.name}{theme.dark && <em>深色</em>}</strong>
                <small>{theme.tagline}</small>
              </span>
              {mode === theme.id && <span className="theme-check"><Check size={12} strokeWidth={3} /></span>}
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}
