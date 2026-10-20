"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Brackets, X } from "lucide-react";
import {
  applyPromptPreset, EMPTY_PRESET, parsePromptPreset, PROMPT_PRESET_KEY, presetActive, type PromptPreset,
} from "@/lib/prompt-preset";

/** 预设提示词保存在当前浏览器;第一次渲染后再读,避免和服务端渲染的结果对不上 */
export function usePromptPreset() {
  const [preset, setPreset] = useState<PromptPreset>(EMPTY_PRESET);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      try { setPreset(parsePromptPreset(JSON.parse(window.localStorage.getItem(PROMPT_PRESET_KEY) || "null"))); } catch { /* 用默认 */ }
    }, 0);
    return () => clearTimeout(timer);
  }, []);
  const save = (next: PromptPreset) => {
    setPreset(next);
    try { window.localStorage.setItem(PROMPT_PRESET_KEY, JSON.stringify(next)); } catch { /* 隐私模式下只本次有效 */ }
  };
  return { preset, save };
}

const CLOSE_MS = 150;

/**
 * 输入框工具栏里的「预设」按钮:点开设置前缀、后缀,发送时自动补到提示词前后。
 * 开着且有内容时按钮高亮,并在旁边显示一个小标记。
 */
export function PromptPresetButton({ preset, onChange, sample }: {
  preset: PromptPreset;
  onChange: (next: PromptPreset) => void;
  /** 输入框里当前的内容,用来预览 */
  sample: string;
}) {
  const [open, setOpen] = useState(false);
  const [closing, setClosing] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const active = presetActive(preset);

  const close = useCallback(() => {
    setClosing(true);
    window.setTimeout(() => { setOpen(false); setClosing(false); }, CLOSE_MS);
  }, []);

  useEffect(() => {
    if (!open || closing) return;
    const pointer = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) close();
    };
    const key = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      // 放大编辑时 Esc 也会收起输入框:这里先拦下
      event.preventDefault();
      close();
    };
    document.addEventListener("mousedown", pointer);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("mousedown", pointer);
      document.removeEventListener("keydown", key);
    };
  }, [open, closing, close]);

  const preview = applyPromptPreset(sample.trim() || "你输入的提示词", { ...preset, enabled: true });

  return <div className="parameter-control prompt-preset" ref={rootRef}>
    <button type="button" className={`icon-button prompt-preset-trigger ${open ? "active" : ""} ${active ? "is-on" : ""}`}
      onClick={() => (open ? close() : setOpen(true))} aria-expanded={open} aria-haspopup="dialog"
      aria-label="预设提示词（前缀和后缀）"
      title={active ? `预设已开启：发送时自动加上${preset.prefix.trim() ? "前缀" : ""}${preset.prefix.trim() && preset.suffix.trim() ? "和" : ""}${preset.suffix.trim() ? "后缀" : ""}` : "预设提示词：设置发送时自动加上的前缀和后缀"}>
      <Brackets size={18} />
      {active && <span className="prompt-preset-dot" aria-hidden="true" />}
    </button>
    {open && <div className={`prompt-preset-popover ${closing ? "is-closing" : ""}`} role="dialog" aria-label="预设提示词">
      <header>
        <div>
          <strong>预设提示词</strong>
          <small>发送时自动加在你输入的内容前后，保存在当前浏览器</small>
        </div>
        <button type="button" className="icon-button" onClick={close} aria-label="关闭"><X size={15} /></button>
      </header>
      <label className="prompt-preset-switch">
        <input type="checkbox" checked={preset.enabled} onChange={(event) => onChange({ ...preset, enabled: event.target.checked })} />
        <span aria-hidden="true" />
        发送时自动加上
      </label>
      <label className="prompt-preset-field">
        <span>前缀</span>
        <textarea rows={3} maxLength={2000} value={preset.prefix} placeholder="例如：电影感画面，柔和自然光"
          onChange={(event) => onChange({ ...preset, prefix: event.target.value })} />
      </label>
      <label className="prompt-preset-field">
        <span>后缀</span>
        <textarea rows={3} maxLength={2000} value={preset.suffix} placeholder="例如：8K 超高清，细节丰富，无水印"
          onChange={(event) => onChange({ ...preset, suffix: event.target.value })} />
      </label>
      <div className="prompt-preset-preview">
        <span>发送效果</span>
        <p>{preview}</p>
      </div>
      <footer>
        <button type="button" disabled={!preset.prefix && !preset.suffix}
          onClick={() => onChange({ ...preset, prefix: "", suffix: "" })}>清空</button>
        <button type="button" className="primary" onClick={close}>完成</button>
      </footer>
    </div>}
  </div>;
}
