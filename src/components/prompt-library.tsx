"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  closestCenter, DndContext, DragOverlay, KeyboardSensor, MouseSensor, TouchSensor, useDroppable,
  useSensor, useSensors, type CollisionDetection, type DragEndEvent, type DragOverEvent, type DragStartEvent,
} from "@dnd-kit/core";
import {
  rectSortingStrategy, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy,
  type SortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  BookMarked, Check, Clock3, FolderPlus, ImageIcon, ListChecks, Pencil, Plus, RectangleHorizontal,
  RotateCcw, Search, Trash2, X,
} from "lucide-react";
import {
  MY_PROMPTS, PROMPT_TEMPLATES, type PromptTemplate, requiredReferences,
} from "@/lib/prompt-library";
import {
  addPromptGroup, arrangePrompts, categoryCounts, categoryOf, hiddenCategoryList, hidePrompts, type LibraryCategory,
  type LibraryFilter, movePrompts, PROMPT_SORTS, type PromptLayout, type PromptSort, removeCategories,
  renamePromptGroup, reorderCategories, reorderPrompts, restoreCategories, restorePrompts, visibleCategories,
} from "@/lib/prompt-layout";
import type { VideoOptions } from "@/lib/types";
import { dragPointer, droppablesUnderPointer, startDragPointer, stopDragPointer } from "@/lib/drag-pointer";

const APPLY_PARAMS_KEY = "mote-prompt-apply-params";
const RATIOS: VideoOptions["ratio"][] = ["16:9", "9:16", "1:1", "4:3", "3:4", "21:9", "adaptive"];
const CARD = "card:";
const CAT = "cat:";
const LIST = "prompt-list";

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
/** 非手动排序时卡片不让位(只能拖到左侧分类) */
const staticStrategy: SortingStrategy = () => null;

/**
 * 拖卡片:先找鼠标正下方的分类(移到该分类),鼠标在卡片列表里时找最近的卡片(调整顺序);
 * 拖分类:只在分类之间找最近的。
 */
const collision: CollisionDetection = (args) => {
  const ofKind = (prefix: string) => args.droppableContainers.filter((item) => String(item.id).startsWith(prefix));
  if (String(args.active.id).startsWith(CARD)) {
    // 键盘拖动:只在卡片之间移动
    if (!dragPointer.tracking) return closestCenter({ ...args, droppableContainers: ofKind(CARD) });
    const category = droppablesUnderPointer(args, CAT);
    if (category.length) return [{ id: category[0].id }];
    if (!droppablesUnderPointer(args, LIST).length) return [];
    return closestCenter({ ...args, droppableContainers: ofKind(CARD) });
  }
  return closestCenter({ ...args, droppableContainers: ofKind(CAT) });
};

/** 键盘拖动只在卡片/分类本身获得焦点时触发,不抢里面按钮的回车和空格 */
function ownKeys(listeners: ReturnType<typeof useSortable>["listeners"]) {
  if (!listeners) return listeners;
  const { onKeyDown, ...rest } = listeners;
  return { ...rest, onKeyDown: (event: React.KeyboardEvent) => { if (event.target === event.currentTarget) onKeyDown?.(event); } };
}

function sortableStyle(transform: Parameters<typeof CSS.Translate.toString>[0], transition?: string): CSSProperties {
  return { transform: CSS.Translate.toString(transform), transition };
}

function SortableCategory({ id, disabled, className, children }: {
  id: string; disabled: boolean; className: string; children: ReactNode;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: CAT + id, disabled });
  return (
    <div ref={setNodeRef} style={sortableStyle(transform, transition)} {...attributes} {...ownKeys(listeners)}
      aria-roledescription="可拖动的分类" className={`${className} ${isDragging ? "is-placeholder" : ""}`}>
      {children}
    </div>
  );
}

function SortableCard({ id, disabled, ghost, className, children }: {
  id: string; disabled: boolean; ghost: boolean; className: string; children: ReactNode;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: CARD + id, disabled });
  return (
    <article ref={setNodeRef} style={sortableStyle(transform, transition)} {...attributes} {...ownKeys(listeners)}
      aria-roledescription="可拖动的提示词卡片"
      className={`${className} ${isDragging || ghost ? "is-placeholder" : ""} ${disabled ? "" : "is-draggable"}`}>
      {children}
    </article>
  );
}

function ListArea({ children }: { children: ReactNode }) {
  const { setNodeRef } = useDroppable({ id: LIST });
  return <div ref={setNodeRef} className="prompt-library-list">{children}</div>;
}

type ActiveDrag = { kind: "cards"; ids: string[]; lead: string } | { kind: "category"; id: string };

export function PromptLibrary({
  open, onClose, onUse, customPrompts, currentPrompt, onSaveCustom, onDeleteCustom, layout, onLayoutChange,
}: {
  open: boolean;
  onClose: () => void;
  onUse: (template: PromptTemplate, mode: PromptUseMode, applyParams: boolean) => void;
  /** 当前用户自己添加的提示词 */
  customPrompts: PromptTemplate[];
  /** 输入框里的内容,新建时直接带入 */
  currentPrompt: string;
  onSaveCustom: (input: CustomPromptInput) => Promise<PromptTemplate>;
  onDeleteCustom: (ids: string[]) => Promise<void>;
  /** 分组、顺序、隐藏、使用次数 */
  layout: PromptLayout;
  onLayoutChange: (layout: PromptLayout) => void;
}) {
  const [category, setCategory] = useState<LibraryFilter>("all");
  const [query, setQuery] = useState("");
  const [categoryQuery, setCategoryQuery] = useState("");
  const [applyParams, setApplyParams] = useState(true);
  const [editing, setEditing] = useState<CustomPromptInput | null>(null);
  const [editingCategory, setEditingCategory] = useState<string>(MY_PROMPTS.id);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");
  const [confirm, setConfirm] = useState<string>();
  const [managing, setManaging] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [selectedCategories, setSelectedCategories] = useState<Set<string>>(() => new Set());
  const [newGroup, setNewGroup] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
  const [activeDrag, setActiveDrag] = useState<ActiveDrag | null>(null);
  const [overCategory, setOverCategory] = useState<string>();
  const [notice, setNotice] = useState("");
  const panelRef = useRef<HTMLDivElement>(null);
  // Esc 取消时输入框随即卸载,可能还会触发一次失焦,这次失焦不算确认
  const skipBlur = useRef(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const templates = useMemo(() => [...customPrompts, ...PROMPT_TEMPLATES], [customPrompts]);
  const byId = useMemo(() => new Map(templates.map((item) => [item.id, item])), [templates]);
  const categories = useMemo(() => visibleCategories(layout), [layout]);
  const hiddenCategories = useMemo(() => hiddenCategoryList(layout), [layout]);
  const counts = useMemo(() => categoryCounts(templates, layout, query), [templates, layout, query]);
  // 当前分类被删掉后回到「全部」
  const activeCategory = category === "all" || category === "hidden" || categories.some((item) => item.id === category)
    ? category : "all";
  const results = useMemo(() => arrangePrompts(templates, layout, activeCategory, query),
    [templates, layout, activeCategory, query]);
  const shownCategories = categoryQuery.trim()
    ? categories.filter((item) => item.name.toLowerCase().includes(categoryQuery.trim().toLowerCase())) : categories;
  const hiddenView = activeCategory === "hidden";
  const canReorder = layout.sort === "manual" && !hiddenView;

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

  const flash = (text: string) => {
    setNotice(text);
    window.setTimeout(() => setNotice((current) => current === text ? "" : current), 3500);
  };
  /** 危险操作点两次才执行:第一次只把按钮变成「确认」,3 秒后复原 */
  const confirmed = (key: string) => {
    if (confirm === key) { setConfirm(undefined); return true; }
    setConfirm(key);
    window.setTimeout(() => setConfirm((current) => current === key ? undefined : current), 3000);
    return false;
  };

  const toggleApply = (value: boolean) => {
    setApplyParams(value);
    try { window.localStorage.setItem(APPLY_PARAMS_KEY, value ? "1" : "0"); } catch { /* 仅本次生效 */ }
  };
  const changeCategory = (id: LibraryFilter) => {
    setCategory(id);
    setSelected(new Set());
    setEditing(null);
  };
  const toggleManaging = () => {
    setManaging((value) => !value);
    setSelected(new Set());
    setSelectedCategories(new Set());
  };

  // ---------- 新建 / 编辑自己的提示词 ----------
  const startCreate = () => {
    setFormError("");
    setEditingCategory(activeCategory === "all" || activeCategory === "hidden" ? MY_PROMPTS.id : activeCategory);
    setEditing(emptyDraft(currentPrompt.trim()));
  };
  const startEdit = (template: PromptTemplate) => {
    setFormError("");
    setEditingCategory(categoryOf(template, layout));
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
      const saved = await onSaveCustom(editing);
      const all = [saved, ...templates.filter((item) => item.id !== saved.id)];
      if (categoryOf(saved, layout) !== editingCategory) onLayoutChange(movePrompts(layout, all, [saved.id], editingCategory));
      setEditing(null);
      setCategory(editingCategory);
    } catch (cause) {
      setFormError((cause as Error).message);
    } finally { setSaving(false); }
  };

  // ---------- 删除 / 恢复卡片 ----------
  /** 自己的提示词真删除,内置的隐藏(可在「已隐藏」里恢复) */
  const removePrompts = async (ids: string[]) => {
    const mine = ids.filter((id) => byId.get(id)?.category === MY_PROMPTS.id);
    const builtin = ids.filter((id) => !mine.includes(id));
    if (builtin.length) onLayoutChange(hidePrompts(layout, builtin));
    if (mine.length) await onDeleteCustom(mine).catch(() => undefined);
    setSelected(new Set());
    if (builtin.length) flash(`已隐藏 ${builtin.length} 条内置提示词，可在「已隐藏」里恢复`);
  };
  const removeOne = (template: PromptTemplate) => {
    if (template.category === MY_PROMPTS.id && !confirmed(`prompt:${template.id}`)) return;
    void removePrompts([template.id]);
  };
  const removeSelected = () => {
    const ids = [...selected];
    const mine = ids.filter((id) => byId.get(id)?.category === MY_PROMPTS.id).length;
    if (mine && !confirmed("bulk-prompts")) return;
    void removePrompts(ids);
  };
  const restoreSelected = (ids: string[]) => {
    onLayoutChange(restorePrompts(layout, templates, ids));
    setSelected(new Set());
  };

  // ---------- 分类 ----------
  // 回车只让输入框失焦,真正的创建/重命名在 onBlur 里做一次,避免回车和失焦各做一遍
  const createGroup = () => {
    if (skipBlur.current) { skipBlur.current = false; return; }
    if (newGroup === null) return;
    setNewGroup(null);
    if (!newGroup.trim()) return;
    try {
      const { layout: next, id } = addPromptGroup(layout, newGroup);
      onLayoutChange(next);
      setCategory(id);
    } catch (cause) { flash((cause as Error).message); }
  };
  const finishRename = () => {
    if (skipBlur.current) { skipBlur.current = false; return; }
    if (renaming) onLayoutChange(renamePromptGroup(layout, renaming.id, renaming.name));
    setRenaming(null);
  };
  const removeCategoryList = (ids: string[]) => {
    const removable = ids.filter((id) => id !== MY_PROMPTS.id);
    if (!removable.length) return;
    const isGroup = (id: string) => layout.groups.some((group) => group.id === id);
    if (removable.some(isGroup) && !confirmed(ids.length > 1 ? "bulk-categories" : `category:${ids[0]}`)) return;
    onLayoutChange(removeCategories(layout, removable));
    setSelectedCategories(new Set());
    if (removable.includes(activeCategory)) setCategory("all");
    const builtin = removable.filter((id) => !isGroup(id)).length;
    flash(builtin ? `已隐藏 ${builtin} 个内置分类，可在「已隐藏」里恢复` : "分组已删除，里面的提示词回到原来的分类");
  };

  // ---------- 拖动 ----------
  const dragStart = (event: DragStartEvent) => {
    const id = String(event.active.id);
    startDragPointer(event);
    if (id.startsWith(CAT)) { setActiveDrag({ kind: "category", id: id.slice(CAT.length) }); return; }
    const lead = id.slice(CARD.length);
    // 批量管理时拖动已选中的卡片 = 拖动全部已选
    const ids = managing && selected.has(lead) ? results.filter((item) => selected.has(item.id)).map((item) => item.id) : [lead];
    setActiveDrag({ kind: "cards", ids, lead });
  };
  const dragOver = ({ over }: DragOverEvent) => {
    const id = over ? String(over.id) : "";
    setOverCategory(activeDrag?.kind === "cards" && id.startsWith(CAT) ? id.slice(CAT.length) : undefined);
  };
  const dragEnd = ({ active, over }: DragEndEvent) => {
    stopDragPointer();
    const drag = activeDrag;
    setActiveDrag(null);
    setOverCategory(undefined);
    if (!drag || !over || over.id === active.id) return;
    const overId = String(over.id);
    if (drag.kind === "category" && overId.startsWith(CAT)) {
      const order = categories.map((item) => item.id);
      const target = overId.slice(CAT.length);
      onLayoutChange(reorderCategories(layout, drag.id, target, order.indexOf(target) > order.indexOf(drag.id)));
      return;
    }
    if (drag.kind !== "cards") return;
    if (overId.startsWith(CAT)) {
      const target = overId.slice(CAT.length);
      onLayoutChange(movePrompts(layout, templates, drag.ids, target));
      setSelected(new Set());
      flash(`已把 ${drag.ids.length} 条提示词移到「${categories.find((item) => item.id === target)?.name}」`);
      return;
    }
    if (overId.startsWith(CARD) && canReorder) {
      const order = results.map((item) => item.id);
      const target = overId.slice(CARD.length);
      onLayoutChange(reorderPrompts(layout, templates, drag.ids, target, order.indexOf(target) > order.indexOf(drag.lead)));
    }
  };
  const dragCancel = () => { stopDragPointer(); setActiveDrag(null); setOverCategory(undefined); };

  const toggle = (set: Set<string>, id: string) => {
    const next = new Set(set);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  };
  const allSelected = results.length > 0 && results.every((item) => selected.has(item.id));
  const selectedMine = [...selected].filter((id) => byId.get(id)?.category === MY_PROMPTS.id).length;
  const categoryTitle = activeCategory === "all" ? "全部" : hiddenView ? "已隐藏"
    : categories.find((item) => item.id === activeCategory)?.name || "";
  const dragging = activeDrag?.kind === "cards" ? new Set(activeDrag.ids) : undefined;

  const cardBody = (template: PromptTemplate, overlay = false) => {
    const refs = requiredReferences(template);
    const mine = template.category === MY_PROMPTS.id;
    const usage = layout.usage[template.id];
    const checked = selected.has(template.id);
    return <>
      <div className="prompt-card-head">
        {managing && !overlay && (
          <input type="checkbox" checked={checked} aria-label={`选择 ${template.title}`}
            onChange={() => setSelected((set) => toggle(set, template.id))} />
        )}
        <h4>{template.title}</h4>
        <div className="prompt-card-tags">
          {mine && <span className="mine-badge">我的</span>}
          {template.tags.map((tag) => <span key={tag}>{tag}</span>)}
        </div>
      </div>
      <p className="prompt-card-text" title={overlay ? undefined : template.prompt}>{template.prompt}</p>
      <footer className="prompt-card-foot">
        <span className="prompt-card-meta">
          {template.ratio && <span><RectangleHorizontal size={12} />{template.ratio === "adaptive" ? "智能比例" : template.ratio}</span>}
          {template.duration && <span><Clock3 size={12} />{template.duration}秒</span>}
          {refs > 0 && <span className="needs-ref"><ImageIcon size={12} />需 {refs} 张参考图</span>}
          {usage?.count ? <span title={`最近使用：${new Date(usage.lastUsedAt).toLocaleString("zh-CN", { hour12: false })}`}>
            用过 {usage.count} 次</span> : null}
          {!overlay && mine && !hiddenView && (
            <button type="button" className="prompt-card-tool" onClick={() => startEdit(template)}
              title="编辑" aria-label="编辑提示词"><Pencil size={12} /></button>
          )}
          {!overlay && !hiddenView && (
            <button type="button" className={`prompt-card-tool danger ${confirm === `prompt:${template.id}` ? "confirm" : ""}`}
              onClick={() => removeOne(template)}
              title={mine ? (confirm === `prompt:${template.id}` ? "再点一次确认删除" : "删除") : "删除（可在已隐藏中恢复）"}
              aria-label="删除提示词">
              <Trash2 size={12} />{confirm === `prompt:${template.id}` && "确认删除"}
            </button>
          )}
        </span>
        <span className="prompt-card-actions">
          {hiddenView ? (
            <button type="button" className="prompt-append" onClick={() => restoreSelected([template.id])}>
              <RotateCcw size={12} />恢复</button>
          ) : <>
            <button type="button" className="prompt-append" tabIndex={overlay ? -1 : undefined}
              onClick={() => onUse(template, "append", applyParams)} title="追加到当前提示词后面"><Plus size={13} />追加</button>
            <button type="button" className="prompt-use" tabIndex={overlay ? -1 : undefined}
              onClick={() => onUse(template, "replace", applyParams)} title="替换输入框中的内容">使用</button>
          </>}
        </span>
      </footer>
    </>;
  };

  const categoryRow = (item: LibraryCategory) => {
    const removable = item.kind !== "mine";
    return <>
      {managing && removable && (
        <input type="checkbox" checked={selectedCategories.has(item.id)} aria-label={`选择分类 ${item.name}`}
          onChange={() => setSelectedCategories((set) => toggle(set, item.id))} />
      )}
      {renaming?.id === item.id ? (
        <input className="prompt-cat-rename" value={renaming.name} maxLength={20} autoFocus
          onChange={(event) => setRenaming({ id: item.id, name: event.target.value })}
          onFocus={() => { skipBlur.current = false; }} onBlur={finishRename}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.currentTarget.blur();
            if (event.key === "Escape") { event.stopPropagation(); skipBlur.current = true; setRenaming(null); }
          }} />
      ) : (
        <button type="button" className={`prompt-cat ${activeCategory === item.id ? "active" : ""} ${counts[item.id] ? "" : "is-empty"}`}
          onClick={() => changeCategory(item.id)} title="按住拖动调整顺序；把卡片拖到这里可移到该分类">
          <em>{item.name}</em><span>{counts[item.id] || 0}</span>
        </button>
      )}
      {!renaming && removable && (
        <span className="prompt-cat-tools">
          {item.kind === "group" && (
            <button type="button" onClick={() => setRenaming({ id: item.id, name: item.name })}
              title="重命名" aria-label={`重命名分组 ${item.name}`}><Pencil size={11} /></button>
          )}
          <button type="button" className={confirm === `category:${item.id}` ? "confirm" : ""}
            onClick={() => removeCategoryList([item.id])}
            title={item.kind === "group" ? (confirm === `category:${item.id}` ? "再点一次确认删除" : "删除分组（提示词回到原分类）")
              : "删除分类（可在已隐藏中恢复）"}
            aria-label={`删除分类 ${item.name}`}><Trash2 size={11} /></button>
        </span>
      )}
    </>;
  };

  const overlayCard = activeDrag?.kind === "cards" ? byId.get(activeDrag.lead) : undefined;
  const overlayCategory = activeDrag?.kind === "category" ? categories.find((item) => item.id === activeDrag.id) : undefined;

  return (
    <div className={`prompt-library ${activeDrag ? "is-dragging" : ""}`} role="dialog" aria-label="提示词库" ref={panelRef}>
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
      <DndContext sensors={sensors} collisionDetection={collision} onDragStart={dragStart} onDragOver={dragOver}
        onDragEnd={dragEnd} onDragCancel={dragCancel}
        accessibility={{ screenReaderInstructions: { draggable: "按空格键拿起，方向键移动，再按空格键放下，Esc 取消" } }}>
        <div className="prompt-library-body">
          <nav className="prompt-library-cats" aria-label="提示词分类">
            <label className="prompt-cat-search">
              <Search size={12} />
              <input value={categoryQuery} onChange={(event) => setCategoryQuery(event.target.value)}
                placeholder="搜索分类" aria-label="搜索分类" />
            </label>
            <button type="button" className={`prompt-cat ${activeCategory === "all" ? "active" : ""}`}
              onClick={() => changeCategory("all")}>
              全部<span>{counts.all}</span>
            </button>
            <SortableContext items={shownCategories.map((item) => CAT + item.id)} strategy={verticalListSortingStrategy}>
              {shownCategories.map((item) => (
                <SortableCategory key={item.id} id={item.id} disabled={renaming?.id === item.id}
                  className={`prompt-cat-item ${item.kind === "mine" ? "is-mine" : ""} ${overCategory === item.id ? "is-drop-target" : ""}`}>
                  {categoryRow(item)}
                </SortableCategory>
              ))}
            </SortableContext>
            {newGroup === null ? (
              <button type="button" className="prompt-cat prompt-cat-add" onClick={() => setNewGroup("")}>
                <FolderPlus size={12} />新建分组
              </button>
            ) : (
              <input className="prompt-cat-rename" value={newGroup} maxLength={20} autoFocus placeholder="分组名称，回车确认"
                onChange={(event) => setNewGroup(event.target.value)}
                onFocus={() => { skipBlur.current = false; }} onBlur={createGroup}
                onKeyDown={(event) => {
                  if (event.key === "Enter") event.currentTarget.blur();
                  if (event.key === "Escape") { event.stopPropagation(); skipBlur.current = true; setNewGroup(null); }
                }} />
            )}
            {managing && selectedCategories.size > 0 && (
              <button type="button" className={`prompt-cat prompt-cat-bulk ${confirm === "bulk-categories" ? "confirm" : ""}`}
                onClick={() => removeCategoryList([...selectedCategories])}>
                <Trash2 size={12} />{confirm === "bulk-categories" ? "确认删除" : `删除所选 ${selectedCategories.size} 个`}
              </button>
            )}
            {(counts.hidden > 0 || hiddenCategories.length > 0) && (
              <button type="button" className={`prompt-cat prompt-cat-hidden ${hiddenView ? "active" : ""}`}
                onClick={() => changeCategory("hidden")}>
                已隐藏<span>{counts.hidden}</span>
              </button>
            )}
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
                <label>分类
                  <select value={editingCategory} onChange={(event) => setEditingCategory(event.target.value)}>
                    {categories.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                  </select>
                </label>
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
            <section className="prompt-library-main">
              <div className="prompt-list-bar">
                <strong>{categoryTitle}<span>{results.length} 条</span></strong>
                {notice && <span className="prompt-list-notice" role="status">{notice}</span>}
                <label className="prompt-sort">排序
                  <select value={layout.sort} aria-label="提示词排序"
                    onChange={(event) => onLayoutChange({ ...layout, sort: event.target.value as PromptSort })}>
                    {PROMPT_SORTS.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                  </select>
                </label>
                <button type="button" className={`prompt-manage ${managing ? "active" : ""}`} onClick={toggleManaging}>
                  {managing ? <><Check size={13} />完成</> : <><ListChecks size={13} />批量管理</>}
                </button>
              </div>
              {managing && (
                <div className="prompt-bulk-bar">
                  <label><input type="checkbox" checked={allSelected} disabled={!results.length}
                    onChange={() => setSelected(allSelected ? new Set() : new Set(results.map((item) => item.id)))} />全选</label>
                  <span>已选 {selected.size} 条</span>
                  {hiddenView ? (
                    <button type="button" disabled={!selected.size} onClick={() => restoreSelected([...selected])}>
                      <RotateCcw size={12} />恢复所选
                    </button>
                  ) : <>
                    <select value="" disabled={!selected.size} aria-label="移动到分类"
                      onChange={(event) => {
                        if (!event.target.value) return;
                        onLayoutChange(movePrompts(layout, templates, [...selected], event.target.value));
                        flash(`已移动 ${selected.size} 条提示词`);
                        setSelected(new Set());
                      }}>
                      <option value="">移动到…</option>
                      {categories.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                    </select>
                    <button type="button" className={`danger ${confirm === "bulk-prompts" ? "confirm" : ""}`}
                      disabled={!selected.size} onClick={removeSelected}>
                      <Trash2 size={12} />
                      {confirm === "bulk-prompts" ? `确认删除（含 ${selectedMine} 条自己的，删除后无法恢复）` : "删除所选"}
                    </button>
                  </>}
                </div>
              )}
              {hiddenView && hiddenCategories.length > 0 && (
                <div className="prompt-hidden-cats">
                  <span>已隐藏的分类</span>
                  {hiddenCategories.map((item) => (
                    <button type="button" key={item.id} onClick={() => onLayoutChange(restoreCategories(layout, [item.id]))}
                      title="恢复这个分类"><RotateCcw size={11} />{item.name}</button>
                  ))}
                </div>
              )}
              <ListArea>
                {results.length === 0 ? (
                  activeCategory === MY_PROMPTS.id && !query ? (
                    <div className="prompt-library-empty">
                      <p>还没有自己的提示词。常用的写法存下来，下次一键使用。</p>
                      <button type="button" className="prompt-use" onClick={startCreate}>
                        {currentPrompt.trim() ? "把当前输入保存为提示词" : "新建提示词"}
                      </button>
                    </div>
                  ) : hiddenView ? <p className="prompt-library-empty">没有隐藏的提示词。</p>
                    : query ? <p className="prompt-library-empty">没有找到相关提示词，换个关键词试试。</p>
                      : <p className="prompt-library-empty">这个分类还是空的。把卡片拖到左侧的分类名上，或在批量管理里「移动到」这里。</p>
                ) : (
                  <SortableContext items={results.map((item) => CARD + item.id)}
                    strategy={canReorder ? rectSortingStrategy : staticStrategy}>
                    {results.map((template) => (
                      <SortableCard key={template.id} id={template.id} disabled={hiddenView}
                        ghost={Boolean(dragging?.has(template.id))}
                        className={`prompt-card ${template.category === MY_PROMPTS.id ? "is-mine" : ""} ${selected.has(template.id) ? "is-selected" : ""}`}>
                        {cardBody(template)}
                      </SortableCard>
                    ))}
                  </SortableContext>
                )}
              </ListArea>
            </section>
          )}
        </div>
        {typeof document !== "undefined" && createPortal(
          <DragOverlay className="mote-drag-overlay">
            {overlayCard ? (
              <article className={`prompt-card is-lifted ${overlayCard.category === MY_PROMPTS.id ? "is-mine" : ""}`}>
                {cardBody(overlayCard, true)}
                {activeDrag?.kind === "cards" && activeDrag.ids.length > 1 && (
                  <span className="drag-count">{activeDrag.ids.length}</span>
                )}
              </article>
            ) : overlayCategory ? (
              <div className="prompt-cat-item is-lifted">
                <span className="prompt-cat active"><em>{overlayCategory.name}</em><span>{counts[overlayCategory.id] || 0}</span></span>
              </div>
            ) : null}
          </DragOverlay>,
          document.body,
        )}
      </DndContext>
      <footer className="prompt-library-foot">
        <label className="prompt-apply-toggle">
          <input type="checkbox" checked={applyParams} onChange={(event) => toggleApply(event.target.checked)} />
          同时应用推荐参数（比例、时长、参考模式）
        </label>
        <span>
          {canReorder ? "按住卡片拖动调整顺序，" : "切到「手动排序」可拖动卡片调整顺序，"}拖到左侧分类可移动 · 【】中的内容请替换成你的主体
        </span>
      </footer>
    </div>
  );
}
