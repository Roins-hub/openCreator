"use client";

import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, Monitor, Palette } from "lucide-react";
import { THEMES, type ThemeId, type ThemeMode, readThemeMode, saveThemeMode } from "@/lib/themes";

const CLOSE_MS = 170;

/** 小色块:自身带 data-theme,用目标主题的纸色 / 侧栏色 / 墨色 */
function Swatch({ theme }: { theme: ThemeId }) {
  return <span className="theme-swatch" data-theme={theme} aria-hidden="true"><i /><b /></span>;
}

/**
 * 顶栏右侧的主题快捷切换(设置页里的主题选择在页面底部,不好找)。
 * 和设置页用同一份存储,两边互相同步;弹出 / 收起都有带回弹的过渡。
 */
export function ThemeQuickPicker() {
  const [mode, setMode] = useState<ThemeMode>("system");
  const [open, setOpen] = useState(false);
  const [closing, setClosing] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => setMode(readThemeMode()), 0);
    const onChange = (event: Event) => setMode((event as CustomEvent<ThemeMode>).detail);
    window.addEventListener("mote-theme-change", onChange);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("mote-theme-change", onChange);
    };
  }, []);

  const close = () => {
    setClosing(true);
    window.setTimeout(() => { setOpen(false); setClosing(false); }, CLOSE_MS);
  };

  useEffect(() => {
    if (!open || closing) return;
    const pointer = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) close();
    };
    const key = (event: KeyboardEvent) => { if (event.key === "Escape") close(); };
    document.addEventListener("mousedown", pointer);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("mousedown", pointer);
      document.removeEventListener("keydown", key);
    };
  });

  const choose = (next: ThemeMode) => {
    setMode(next);
    saveThemeMode(next);
  };

  const current = THEMES.find((theme) => theme.id === mode);
  const options: { id: ThemeMode; name: string; tagline: string; dark?: boolean }[] = [
    { id: "system", name: "跟随系统", tagline: "米白 / 石墨 自动切换" },
    ...THEMES,
  ];

  return <div className="theme-quick" ref={rootRef}>
    <button type="button" className={`theme-quick-trigger ${open && !closing ? "active" : ""}`} aria-haspopup="listbox"
      aria-expanded={open} title="切换主题" onClick={() => (open ? close() : setOpen(true))}>
      {current ? <Swatch theme={current.id} /> : <Monitor size={13} />}
      <span>{current?.name || "跟随系统"}</span>
      <ChevronDown size={13} className="theme-quick-chevron" />
    </button>
    {open && <div className={`theme-quick-popover ${closing ? "is-closing" : ""}`} role="listbox" aria-label="主题">
      <small><Palette size={12} />主题</small>
      {options.map((option, index) => (
        <button type="button" role="option" aria-selected={mode === option.id} key={option.id}
          className={mode === option.id ? "selected" : ""} style={{ animationDelay: `${Math.min(index, 10) * 18}ms` }}
          onClick={() => choose(option.id)}>
          {option.id === "system"
            ? <span className="theme-swatch is-system" aria-hidden="true"><Swatch theme="paper" /><Swatch theme="graphite" /></span>
            : <Swatch theme={option.id} />}
          <span className="theme-quick-text">
            <b>{option.name}{option.dark && <em>深色</em>}</b>
            <small>{option.tagline}</small>
          </span>
          {mode === option.id && <Check size={14} className="theme-quick-check" />}
        </button>
      ))}
    </div>}
  </div>;
}
