"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Pencil, Plus, Wand2 } from "lucide-react";
import { EMPTY_PRESET, parsePromptPreset, PROMPT_PRESET_KEY, presetActive, type PromptPreset } from "@/lib/prompt-preset";

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

type Part = "prefix" | "suffix";
const LABEL: Record<Part, string> = { prefix: "前缀", suffix: "后缀" };
const PLACEHOLDER: Record<Part, string> = {
  prefix: "加在提示词最前面，例如：电影感画面，柔和自然光",
  suffix: "加在提示词最后面，例如：8K 超高清，细节丰富，无水印",
};
const CLOSE_MS = 140;

/** 前缀或后缀的一块:直接显示文字,点击单独编辑 */
function PresetChip({ part, value, onSave }: { part: Part; value: string; onSave: (value: string) => void }) {
  const [open, setOpen] = useState(false);
  const [closing, setClosing] = useState(false);
  const [text, setText] = useState(value);
  const rootRef = useRef<HTMLDivElement>(null);
  const filled = Boolean(value.trim());

  const close = useCallback(() => {
    setClosing(true);
    window.setTimeout(() => { setOpen(false); setClosing(false); }, CLOSE_MS);
  }, []);
  const save = () => {
    onSave(text);
    close();
  };

  useEffect(() => {
    if (!open || closing) return;
    const pointer = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) close();
    };
    document.addEventListener("mousedown", pointer);
    return () => document.removeEventListener("mousedown", pointer);
  }, [open, closing, close]);

  return <div className="preset-chip-wrap" ref={rootRef}>
    <button type="button" className={`preset-chip ${filled ? "is-filled" : ""} ${open ? "active" : ""}`}
      onClick={() => { if (open) close(); else { setText(value); setOpen(true); } }}
      aria-expanded={open} aria-haspopup="dialog" title={filled ? `${LABEL[part]}：${value.trim()}（点击编辑）` : `添加${LABEL[part]}`}>
      <b>{LABEL[part]}</b>
      {filled ? <><span>{value.trim()}</span><Pencil size={11} /></> : <><Plus size={12} /><em>添加</em></>}
    </button>
    {open && <div className={`preset-editor ${closing ? "is-closing" : ""}`} role="dialog" aria-label={`编辑${LABEL[part]}`}>
      <strong>{LABEL[part]}<small>{part === "prefix" ? "发送时加在你输入的内容前面" : "发送时加在你输入的内容后面"}</small></strong>
      <textarea autoFocus rows={4} maxLength={2000} value={text} placeholder={PLACEHOLDER[part]}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          // Esc 只关掉这个编辑框(不收起放大的输入框),Ctrl / ⌘ + Enter 保存
          if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(); }
          if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) { event.preventDefault(); save(); }
        }} />
      <footer>
        {filled && <button type="button" className="danger-text" onClick={() => { onSave(""); close(); }}>删除{LABEL[part]}</button>}
        <span />
        <button type="button" onClick={close}>取消</button>
        <button type="button" className="primary" onClick={save}>保存</button>
      </footer>
    </div>}
  </div>;
}

/**
 * 输入框上方的「预设提示词」:前缀、后缀分开显示和编辑,发送时自动补到提示词前后;右边可以暂停。
 */
export function PromptPresetBar({ preset, onChange }: { preset: PromptPreset; onChange: (next: PromptPreset) => void }) {
  const hasAny = Boolean(preset.prefix.trim() || preset.suffix.trim());
  return <div className={`preset-bar ${hasAny && !preset.enabled ? "is-paused" : ""} ${presetActive(preset) ? "is-active" : ""}`}
    aria-label="预设提示词">
    <span className="preset-bar-title"><Wand2 size={12} />预设</span>
    <PresetChip part="prefix" value={preset.prefix} onSave={(prefix) => onChange({ ...preset, prefix })} />
    {/* 发送时的拼接顺序:前缀 + 你输入的提示词 + 后缀 */}
    <span className="preset-bar-flow" aria-hidden="true">+ 你的提示词 +</span>
    <PresetChip part="suffix" value={preset.suffix} onSave={(suffix) => onChange({ ...preset, suffix })} />
    {hasAny && <label className="preset-switch" title={preset.enabled ? "发送时会自动加上前缀和后缀" : "已暂停，发送时不加"}>
      <input type="checkbox" checked={preset.enabled} onChange={(event) => onChange({ ...preset, enabled: event.target.checked })} />
      <span aria-hidden="true" />
      {preset.enabled ? "自动添加" : "已暂停"}
    </label>}
  </div>;
}
