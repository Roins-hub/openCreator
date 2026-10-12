"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { BookMarked, Clock3, ImageIcon, Pencil, Plus, RectangleHorizontal, Search, Trash2, X } from "lucide-react";
import {
  MY_PROMPTS, PROMPT_CATEGORIES, PROMPT_TEMPLATES, type PromptFilter, type PromptTemplate,
  requiredReferences, searchPrompts,
} from "@/lib/prompt-library";
import type { VideoOptions } from "@/lib/types";

const APPLY_PARAMS_KEY = "mote-prompt-apply-params";
const RATIOS: VideoOptions["ratio"][] = ["16:9", "9:16", "1:1", "4:3", "3:4", "21:9", "adaptive"];

export type PromptUseMode = "replace" | "append";

export interface CustomPromptInput {
  id?: string;
  title: string;
  prompt: string;
  tags: string;
  ratio?: VideoOptions["ratio"];
  duration?: number;
}

function readApplyParams() {
  try { return window.localStorage.getItem(APPLY_PARAMS_KEY) !== "0"; } catch { return true; }
}

const emptyDraft = (prompt = ""): CustomPromptInput => ({ title: "", prompt, tags: "" });

export function PromptLibrary({
  open, onClose, onUse, customPrompts, currentPrompt, onSaveCustom, onDeleteCustom,
}: {
  open: boolean;
  onClose: () => void;
  onUse: (template: PromptTemplate, mode: PromptUseMode, applyParams: boolean) => void;
  /** 当前用户自己添加的提示词 */
  customPrompts: PromptTemplate[];
  /** 输入框里的内容,新建时直接带入 */
  currentPrompt: string;
  onSaveCustom: (input: CustomPromptInput) => Promise<void>;
  onDeleteCustom: (id: string) => Promise<void>;
}) {
  const [category, setCategory] = useState<PromptFilter>("all");
  const [query, setQuery] = useState("");
  const [applyParams, setApplyParams] = useState(true);
  const [editing, setEditing] = useState<CustomPromptInput | null>(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");
  const [confirmDelete, setConfirmDelete] = useState<string>();
  const panelRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  // 自定义的排在内置的前面
  const templates = useMemo(() => [...customPrompts, ...PROMPT_TEMPLATES], [customPrompts]);
  const results = useMemo(() => searchPrompts(query, category, templates), [query, category, templates]);
  const counts = useMemo(() => {
    const matched = searchPrompts(query, "all", templates);
    return Object.fromEntries([MY_PROMPTS, ...PROMPT_CATEGORIES].map((item) =>
      [item.id, matched.filter((t) => t.category === item.id).length]));
  }, [query, templates]);

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
    const key = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      // 正在编辑时 Esc 先关表单
      if (panelRef.current?.querySelector(".prompt-editor")) setEditing(null);
      else onClose();
    };
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

  const startCreate = () => {
    setFormError("");
    setEditing(emptyDraft(currentPrompt.trim()));
  };
  const startEdit = (template: PromptTemplate) => {
    setFormError("");
    setEditing({
      id: template.id, title: template.title, prompt: template.prompt, tags: template.tags.join("，"),
      ratio: template.ratio, duration: template.duration,
    });
  };
  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!editing) return;
    if (!editing.title.trim() || !editing.prompt.trim()) {
      setFormError("标题和提示词都要填写");
      return;
    }
    setSaving(true);
    setFormError("");
    try {
      await onSaveCustom(editing);
      setEditing(null);
      setCategory(MY_PROMPTS.id);
    } catch (cause) {
      setFormError((cause as Error).message);
    } finally { setSaving(false); }
  };
  const remove = async (id: string) => {
    if (confirmDelete !== id) {
      // 3 秒内再点一次才删除
      setConfirmDelete(id);
      window.setTimeout(() => setConfirmDelete((current) => current === id ? undefined : current), 3000);
      return;
    }
    setConfirmDelete(undefined);
    await onDeleteCustom(id).catch(() => undefined);
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
        <button type="button" className="prompt-new" onClick={startCreate} title="新建自己的提示词（会带上输入框里的内容）">
          <Plus size={14} />新建
        </button>
        <button type="button" className="icon-button" onClick={onClose} aria-label="关闭提示词库"><X size={16} /></button>
      </header>
      <div className="prompt-library-body">
        <nav className="prompt-library-cats" aria-label="提示词分类">
          <button type="button" className={category === "all" ? "active" : ""} onClick={() => setCategory("all")}>
            全部<span>{searchPrompts(query, "all", templates).length}</span>
          </button>
          <button type="button" className={`is-mine ${category === MY_PROMPTS.id ? "active" : ""}`}
            onClick={() => setCategory(MY_PROMPTS.id)}>
            {MY_PROMPTS.name}<span>{counts[MY_PROMPTS.id]}</span>
          </button>
          {PROMPT_CATEGORIES.map((item) => (
            <button type="button" key={item.id} className={category === item.id ? "active" : ""}
              onClick={() => setCategory(item.id)} disabled={!counts[item.id]}>
              {item.name}<span>{counts[item.id]}</span>
            </button>
          ))}
        </nav>
        {editing ? (
          <form className="prompt-editor" onSubmit={save}>
            <h4>{editing.id ? "编辑提示词" : "新建提示词"}</h4>
            <label>标题
              <input value={editing.title} maxLength={40} autoFocus placeholder="例如：产品 360° 旋转展示"
                onChange={(event) => setEditing({ ...editing, title: event.target.value })} />
            </label>
            <label>提示词
              <textarea value={editing.prompt} maxLength={4000} rows={4}
                placeholder="写下完整的提示词，可以用【】标出每次需要替换的主体"
                onChange={(event) => setEditing({ ...editing, prompt: event.target.value })} />
            </label>
            <label>标签<small>（选填，用逗号或空格分隔，最多 6 个）</small>
              <input value={editing.tags} placeholder="例如：电商，旋转，白底"
                onChange={(event) => setEditing({ ...editing, tags: event.target.value })} />
            </label>
            <div className="prompt-editor-row">
              <label>推荐比例
                <select value={editing.ratio || ""}
                  onChange={(event) => setEditing({ ...editing, ratio: (event.target.value || undefined) as CustomPromptInput["ratio"] })}>
                  <option value="">不指定</option>
                  {RATIOS.map((ratio) => <option key={ratio} value={ratio}>{ratio === "adaptive" ? "智能比例" : ratio}</option>)}
                </select>
              </label>
              <label>推荐时长（秒）
                <input type="number" min={1} max={60} value={editing.duration ?? ""} placeholder="不指定"
                  onChange={(event) => setEditing({
                    ...editing, duration: event.target.value ? Math.round(Number(event.target.value)) : undefined,
                  })} />
              </label>
            </div>
            {formError && <p className="prompt-editor-error">{formError}</p>}
            <footer>
              <button type="button" className="prompt-append" onClick={() => setEditing(null)}>取消</button>
              <button type="submit" className="prompt-use" disabled={saving}>{saving ? "保存中…" : "保存"}</button>
            </footer>
          </form>
        ) : (
          <div className="prompt-library-list">
            {results.length === 0 ? (
              category === MY_PROMPTS.id && !query ? (
                <div className="prompt-library-empty">
                  <p>还没有自己的提示词。常用的写法存下来，下次一键使用。</p>
                  <button type="button" className="prompt-use" onClick={startCreate}>
                    {currentPrompt.trim() ? "把当前输入保存为提示词" : "新建提示词"}
                  </button>
                </div>
              ) : <p className="prompt-library-empty">没有找到相关提示词，换个关键词试试。</p>
            ) : results.map((template) => {
              const refs = requiredReferences(template);
              const mine = template.category === MY_PROMPTS.id;
              return (
                <article className={`prompt-card ${mine ? "is-mine" : ""}`} key={template.id}>
                  <div className="prompt-card-head">
                    <h4>{template.title}</h4>
                    <div className="prompt-card-tags">
                      {mine && <span className="mine-badge">我的</span>}
                      {template.tags.map((tag) => <span key={tag}>{tag}</span>)}
                    </div>
                  </div>
                  <p className="prompt-card-text" title={template.prompt}>{template.prompt}</p>
                  <footer className="prompt-card-foot">
                    <span className="prompt-card-meta">
                      {template.ratio && <span><RectangleHorizontal size={12} />{template.ratio === "adaptive" ? "智能比例" : template.ratio}</span>}
                      {template.duration && <span><Clock3 size={12} />{template.duration}秒</span>}
                      {refs > 0 && <span className="needs-ref"><ImageIcon size={12} />需 {refs} 张参考图</span>}
                      {mine && <>
                        <button type="button" className="prompt-card-tool" onClick={() => startEdit(template)}
                          title="编辑" aria-label="编辑提示词"><Pencil size={12} /></button>
                        <button type="button" className={`prompt-card-tool danger ${confirmDelete === template.id ? "confirm" : ""}`}
                          onClick={() => void remove(template.id)}
                          title={confirmDelete === template.id ? "再点一次确认删除" : "删除"} aria-label="删除提示词">
                          <Trash2 size={12} />{confirmDelete === template.id && "确认删除"}
                        </button>
                      </>}
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
        )}
      </div>
      <footer className="prompt-library-foot">
        <label className="prompt-apply-toggle">
          <input type="checkbox" checked={applyParams} onChange={(event) => toggleApply(event.target.checked)} />
          同时应用推荐参数（比例、时长、参考模式）
        </label>
        <span>{PROMPT_TEMPLATES.length} 条内置 · {customPrompts.length} 条自定义 · 【】中的内容请替换成你的主体</span>
      </footer>
    </div>
  );
}
