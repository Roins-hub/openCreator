"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { BookMarked, Clock3, ImageIcon, Plus, RectangleHorizontal, Search, X } from "lucide-react";
import {
  PROMPT_CATEGORIES, PROMPT_TEMPLATES, type PromptCategoryId, type PromptTemplate,
  requiredReferences, searchPrompts,
} from "@/lib/prompt-library";

const APPLY_PARAMS_KEY = "mote-prompt-apply-params";

export type PromptUseMode = "replace" | "append";

function readApplyParams() {
  try { return window.localStorage.getItem(APPLY_PARAMS_KEY) !== "0"; } catch { return true; }
}

export function PromptLibrary({
  open, onClose, onUse,
}: {
  open: boolean;
  onClose: () => void;
  onUse: (template: PromptTemplate, mode: PromptUseMode, applyParams: boolean) => void;
}) {
  const [category, setCategory] = useState<PromptCategoryId | "all">("all");
  const [query, setQuery] = useState("");
  const [applyParams, setApplyParams] = useState(true);
  const panelRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const results = useMemo(() => searchPrompts(query, category), [query, category]);
  const counts = useMemo(() => {
    const matched = searchPrompts(query, "all");
    return Object.fromEntries(PROMPT_CATEGORIES.map((item) => [item.id, matched.filter((t) => t.category === item.id).length]));
  }, [query]);

  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(() => {
      setApplyParams(readApplyParams());
      searchRef.current?.focus();
    }, 0);
    const pointer = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      if (panelRef.current?.contains(target) || target.closest?.("[data-prompt-library-trigger]")) return;
      onClose();
    };
    const key = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    document.addEventListener("mousedown", pointer);
    document.addEventListener("keydown", key);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("mousedown", pointer);
      document.removeEventListener("keydown", key);
    };
  }, [open, onClose]);

  if (!open) return null;

  const toggleApply = (value: boolean) => {
    setApplyParams(value);
    try { window.localStorage.setItem(APPLY_PARAMS_KEY, value ? "1" : "0"); } catch { /* 仅本次生效 */ }
  };

  return (
    <div className="prompt-library" role="dialog" aria-label="提示词库" ref={panelRef}>
      <header className="prompt-library-head">
        <strong><BookMarked size={15} />提示词库</strong>
        <label className="prompt-library-search">
          <Search size={14} />
          <input ref={searchRef} value={query} onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索场景、风格或运镜，如：慢动作、航拍、国风" aria-label="搜索提示词" />
        </label>
        <button type="button" className="icon-button" onClick={onClose} aria-label="关闭提示词库"><X size={16} /></button>
      </header>
      <div className="prompt-library-body">
        <nav className="prompt-library-cats" aria-label="提示词分类">
          <button type="button" className={category === "all" ? "active" : ""} onClick={() => setCategory("all")}>
            全部<span>{searchPrompts(query, "all").length}</span>
          </button>
          {PROMPT_CATEGORIES.map((item) => (
            <button type="button" key={item.id} className={category === item.id ? "active" : ""}
              onClick={() => setCategory(item.id)} disabled={!counts[item.id]}>
              {item.name}<span>{counts[item.id]}</span>
            </button>
          ))}
        </nav>
        <div className="prompt-library-list">
          {results.length === 0 ? (
            <p className="prompt-library-empty">没有找到相关提示词，换个关键词试试。</p>
          ) : results.map((template) => {
            const refs = requiredReferences(template);
            return (
              <article className="prompt-card" key={template.id}>
                <div className="prompt-card-head">
                  <h4>{template.title}</h4>
                  <div className="prompt-card-tags">{template.tags.map((tag) => <span key={tag}>{tag}</span>)}</div>
                </div>
                <p className="prompt-card-text" title={template.prompt}>{template.prompt}</p>
                <footer className="prompt-card-foot">
                  <span className="prompt-card-meta">
                    {template.ratio && <span><RectangleHorizontal size={12} />{template.ratio === "adaptive" ? "智能比例" : template.ratio}</span>}
                    {template.duration && <span><Clock3 size={12} />{template.duration}秒</span>}
                    {refs > 0 && <span className="needs-ref"><ImageIcon size={12} />需 {refs} 张参考图</span>}
                  </span>
                  <span className="prompt-card-actions">
                    <button type="button" className="prompt-append" onClick={() => onUse(template, "append", applyParams)}
                      title="追加到当前提示词后面"><Plus size={13} />追加</button>
                    <button type="button" className="prompt-use" onClick={() => onUse(template, "replace", applyParams)}
                      title="替换输入框中的内容">使用</button>
                  </span>
                </footer>
              </article>
            );
          })}
        </div>
      </div>
      <footer className="prompt-library-foot">
        <label className="prompt-apply-toggle">
          <input type="checkbox" checked={applyParams} onChange={(event) => toggleApply(event.target.checked)} />
          同时应用推荐参数（比例、时长、参考模式）
        </label>
        <span>共 {PROMPT_TEMPLATES.length} 条内置提示词 · 【】中的内容请替换成你的主体</span>
      </footer>
    </div>
  );
}
