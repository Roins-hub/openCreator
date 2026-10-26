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
  BookMarked, Check, ChevronDown, Clock3, CornerUpLeft, Folder, FolderPlus, ImageIcon, ListChecks, Pencil, Plus, RectangleHorizontal,
  RotateCcw, Search, Trash2, X,
} from "lucide-react";
import {
  MY_PROMPTS, PROMPT_TEMPLATES, type PromptTemplate, requiredReferences,
} from "@/lib/prompt-library";
import {
  addPromptGroup, arrangePrompts, categoryCounts, categoryOf, categoryTree, hiddenCategoryList, hidePrompts, nestCategories,
  parentOf, toggleGroupCollapsed, type LibraryCategory,
  type LibraryFilter, movePrompts, PROMPT_SORTS, type PromptLayout, type PromptSort, removeCategories,
  addPromptCategory, renamePromptGroup, reorderCategories, reorderPrompts, restoreCategories, restorePrompts, visibleCategories,
} from "@/lib/prompt-layout";
import type { VideoOptions } from "@/lib/types";
import { Dropdown } from "@/components/dropdown";
import { usePresence } from "@/components/use-presence";
import { dragPointer, droppablesUnderPointer, startDragPointer, stopDragPointer } from "@/lib/drag-pointer";

const APPLY_PARAMS_KEY = "mote-prompt-apply-params";
const RATIOS: VideoOptions["ratio"][] = ["16:9", "9:16", "1:1", "4:3", "3:4", "21:9", "adaptive"];
const NO_RATIO = "none";
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
  // 收起时先播放收起动画再卸载
  const presence = usePresence(open);
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
  // 左侧分类栏自己的批量选择(和右侧卡片的「批量管理」分开,也能单独用)
  const [catManaging, setCatManaging] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [selectedCategories, setSelectedCategories] = useState<Set<string>>(() => new Set());
  const [newGroup, setNewGroup] = useState<string | null>(null);
  // 分组旁的「+」:在这个分组里新建分类
  const [newCategory, setNewCategory] = useState<{ groupId: string; name: string } | null>(null);
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
  // 左侧分类树:分组下面挂着放进去的分类;搜索时只留匹配的(分组名匹配时整组都留),并自动展开
  const tree = useMemo(() => categoryTree(layout), [layout]);
  const catQuery = categoryQuery.trim().toLowerCase();
  const catMatches = (item: LibraryCategory) => !catQuery || item.name.toLowerCase().includes(catQuery);
  const shownTree = tree.flatMap((node) => {
    const groupHit = catMatches(node.category);
    const children = groupHit ? node.children : node.children.filter(catMatches);
    if (!groupHit && !children.length) return [];
    const group = layout.groups.find((item) => item.id === node.category.id);
    return [{ ...node, children, expanded: Boolean(catQuery) || !group?.collapsed }];
  });
  // 拖动排序用的平铺顺序:收起的分组里的分类不参与
  const flatCategoryIds = shownTree.flatMap((node) => [node.category.id, ...(node.expanded ? node.children.map((item) => item.id) : [])]);
  // 能批量选的分类:当前(搜索后)列出的全部,「我的提示词」不能删除
  const pickingCategories = managing || catManaging;
  const selectableCategoryIds = shownTree
    .flatMap((node) => [node.category, ...node.children])
    .filter((item) => item.kind !== "mine")
    .map((item) => item.id);
  const allCategoriesSelected = selectableCategoryIds.length > 0 && selectableCategoryIds.every((id) => selectedCategories.has(id));
  // 正在把分类拖进某个分组:这时其他分类不让位,只高亮那个分组
  const intoGroupRef = useRef<string | undefined>(undefined);
  const categoryStrategy: SortingStrategy = (args) => (intoGroupRef.current ? null : verticalListSortingStrategy(args));
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
      // 下拉框自己处理的 Esc(收起列表)不再关闭整个提示词库
      if (event.key !== "Escape" || event.defaultPrevented) return;
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

  if (!presence.mounted) return null;

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
  const toggleCatManaging = () => {
    setCatManaging((value) => !value);
    setSelectedCategories(new Set());
  };

  // ---------- 新建 / 编辑自己的提示词 ----------
  const startCreate = () => startCreateIn(activeCategory === "all" || activeCategory === "hidden" ? MY_PROMPTS.id : activeCategory);
  /** 直接在某个分类 / 分组下新建(左侧每个分类旁边的 +) */
  const startCreateIn = (categoryId: string) => {
    setFormError("");
    setEditingCategory(categoryId);
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
  const createCategory = () => {
    if (skipBlur.current) { skipBlur.current = false; return; }
    if (!newCategory) return;
    setNewCategory(null);
    if (!newCategory.name.trim()) return;
    try {
      const { layout: next, id } = addPromptCategory(layout, newCategory.name, newCategory.groupId);
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
    const isCustom = (id: string) => (layout.categories || []).some((item) => item.id === id);
    // 删分组、删自建分类、一次删多个都要点两次确认
    if ((removable.length > 1 || removable.some((id) => isGroup(id) || isCustom(id)))
      && !confirmed(ids.length > 1 ? "bulk-categories" : `category:${ids[0]}`)) return;
    onLayoutChange(removeCategories(layout, removable));
    setSelectedCategories(new Set());
    if (removable.includes(activeCategory)) setCategory("all");
    const builtin = removable.filter((id) => !isGroup(id) && !isCustom(id)).length;
    flash(builtin ? `已隐藏 ${builtin} 个内置分类，可在「已隐藏」里恢复` : "已删除，里面的提示词回到原来的分类");
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
    const target = id.startsWith(CAT) ? id.slice(CAT.length) : undefined;
    if (activeDrag?.kind === "category") {
      const dragging = activeDrag.id;
      const isGroup = (value?: string) => Boolean(value && layout.groups.some((group) => group.id === value));
      const into = !isGroup(dragging) && isGroup(target) && parentOf(layout, dragging) !== target ? target : undefined;
      intoGroupRef.current = into;
      setOverCategory(into);
      return;
    }
    setOverCategory(activeDrag?.kind === "cards" ? target : undefined);
  };
  const dragEnd = ({ active, over }: DragEndEvent) => {
    stopDragPointer();
    const drag = activeDrag;
    setActiveDrag(null);
    setOverCategory(undefined);
    if (!drag || !over || over.id === active.id) return;
    const overId = String(over.id);
    const into = intoGroupRef.current;
    intoGroupRef.current = undefined;
    if (drag.kind === "category" && overId.startsWith(CAT)) {
      const target = overId.slice(CAT.length);
      if (into) {
        // 放进分组;分组收着的话顺手展开,能看到放进去了
        let next = nestCategories(layout, [drag.id], into);
        if (layout.groups.find((group) => group.id === into)?.collapsed) next = toggleGroupCollapsed(next, into);
        onLayoutChange(next);
        flash(`已把「${categories.find((item) => item.id === drag.id)?.name}」放进「${categories.find((item) => item.id === into)?.name}」`);
        return;
      }
      onLayoutChange(reorderCategories(layout, drag.id, target, flatCategoryIds.indexOf(target) > flatCategoryIds.indexOf(drag.id)));
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
  const dragCancel = () => { stopDragPointer(); intoGroupRef.current = undefined; setActiveDrag(null); setOverCategory(undefined); };

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

  const categoryRow = (item: LibraryCategory, expanded = true) => {
    const removable = item.kind !== "mine";
    const parent = parentOf(layout, item.id);
    return <>
      {pickingCategories && removable && (
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
        <button type="button" className={`prompt-cat ${item.kind === "group" ? "is-group" : ""} ${activeCategory === item.id ? "active" : ""} ${counts[item.id] ? "" : "is-empty"}`}
          onClick={() => changeCategory(item.id)}
          title={item.kind === "group" ? "按住拖动调整顺序；把分类或卡片拖到这里可放进这个分组" : "按住拖动调整顺序；拖到分组上可放进分组；把卡片拖到这里可移到该分类"}>
          {item.kind === "group" && (
            <span className={`prompt-cat-chevron ${expanded ? "" : "is-collapsed"}`} role="button" tabIndex={-1}
              aria-label={expanded ? "收起分组" : "展开分组"}
              onClick={(event) => { event.stopPropagation(); onLayoutChange(toggleGroupCollapsed(layout, item.id)); }}>
              <ChevronDown size={13} />
            </span>
          )}
          {item.kind === "group" && <Folder size={13} className="prompt-cat-folder" />}
          <em>{item.name}</em><span>{counts[item.id] || 0}</span>
        </button>
      )}
      {!renaming && (
        <span className="prompt-cat-tools">
          {item.kind === "group" && <button type="button" onClick={() => setNewCategory({ groupId: item.id, name: "" })}
            title={`在「${item.name}」里新建分类`} aria-label={`在 ${item.name} 里新建分类`}><Plus size={12} /></button>}
          {removable && parent && (
            <button type="button" onClick={() => onLayoutChange(nestCategories(layout, [item.id], undefined))}
              title="移出分组" aria-label={`把 ${item.name} 移出分组`}><CornerUpLeft size={11} /></button>
          )}
          {(item.kind === "group" || item.kind === "custom") && (
            <button type="button" onClick={() => setRenaming({ id: item.id, name: item.name })}
              title="重命名" aria-label={`重命名 ${item.name}`}><Pencil size={11} /></button>
          )}
          {removable && <button type="button" className={`is-delete ${confirm === `category:${item.id}` ? "confirm" : ""}`}
            onClick={() => removeCategoryList([item.id])}
            title={item.kind === "builtin" ? "删除分类（可在已隐藏中恢复）"
              : confirm === `category:${item.id}` ? "再点一次确认删除"
                : item.kind === "group" ? "删除分组（提示词回到原分类）" : "删除分类（提示词回到原分类）"}
            aria-label={`删除分类 ${item.name}`}><Trash2 size={11} /></button>}
        </span>
      )}
    </>;
  };

  const overlayCard = activeDrag?.kind === "cards" ? byId.get(activeDrag.lead) : undefined;
  const overlayCategory = activeDrag?.kind === "category" ? categories.find((item) => item.id === activeDrag.id) : undefined;

  return (
    <div className={`prompt-library ${activeDrag ? "is-dragging" : ""} ${presence.closing ? "is-closing" : ""}`} role="dialog" aria-label="提示词库"
      ref={panelRef} inert={presence.closing}>
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
            {/* 和工作台侧栏一样:小标题 + 新建分组按钮、搜索框、分组输入框 */}
            <div className="prompt-cat-label">
              <span>分类</span>
              <span className="prompt-cat-head-tools">
                <button type="button" title="新建分组" aria-label="新建分组" onClick={() => setNewGroup("")}>
                  <FolderPlus size={14} />
                </button>
                <button type="button" className={catManaging ? "active" : ""} aria-pressed={catManaging}
                  title={catManaging ? "完成" : "批量选择分类（全选、删除）"} aria-label="批量选择分类" onClick={toggleCatManaging}>
                  {catManaging ? <Check size={14} /> : <ListChecks size={14} />}
                </button>
              </span>
            </div>
            <label className="prompt-cat-search">
              <Search size={13} />
              <input type="search" value={categoryQuery} onChange={(event) => setCategoryQuery(event.target.value)}
                onKeyDown={(event) => { if (event.key === "Escape" && categoryQuery) { event.stopPropagation(); setCategoryQuery(""); } }}
                placeholder="搜索分类" aria-label="搜索分类" />
              {categoryQuery && <button type="button" aria-label="清空搜索" onClick={() => setCategoryQuery("")}><X size={13} /></button>}
            </label>
            {catManaging && (
              <div className="prompt-cat-bulk-bar" role="toolbar" aria-label="批量操作分类">
                <label>
                  <input type="checkbox" checked={allCategoriesSelected} disabled={!selectableCategoryIds.length}
                    onChange={() => setSelectedCategories(allCategoriesSelected ? new Set() : new Set(selectableCategoryIds))} />
                  全选
                </label>
                <span>已选 {selectedCategories.size}</span>
                <button type="button" className={`danger ${confirm === "bulk-categories" || confirm?.startsWith("category:") ? "confirm" : ""}`}
                  disabled={!selectedCategories.size} onClick={() => removeCategoryList([...selectedCategories])}
                  title="内置分类会隐藏（可在「已隐藏」里恢复）；分组删除后里面的提示词回到原来的分类">
                  <Trash2 size={12} />
                  {confirm === "bulk-categories" || confirm?.startsWith("category:") ? "确认删除" : "删除"}
                </button>
                <button type="button" onClick={toggleCatManaging}>完成</button>
              </div>
            )}
            {newGroup !== null && (
              <div className="prompt-cat-create">
                <Folder size={14} />
                <input className="prompt-cat-rename" value={newGroup} maxLength={20} autoFocus placeholder="分组名称，回车创建"
                  onChange={(event) => setNewGroup(event.target.value)}
                  onFocus={() => { skipBlur.current = false; }} onBlur={createGroup}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") event.currentTarget.blur();
                    if (event.key === "Escape") { event.stopPropagation(); skipBlur.current = true; setNewGroup(null); }
                  }} />
              </div>
            )}
            <button type="button" className={`prompt-cat ${activeCategory === "all" ? "active" : ""}`}
              onClick={() => changeCategory("all")}>
              全部<span>{counts.all}</span>
            </button>
            <SortableContext items={flatCategoryIds.map((id) => CAT + id)} strategy={categoryStrategy}>
              {shownTree.map(({ category: item, children, expanded }) => (
                <div key={item.id} className="prompt-cat-node">
                  <SortableCategory id={item.id} disabled={renaming?.id === item.id}
                    className={`prompt-cat-item ${item.kind === "mine" ? "is-mine" : ""} ${overCategory === item.id ? "is-drop-target" : ""}`}>
                    {categoryRow(item, expanded)}
                  </SortableCategory>
                  {item.kind === "group" && (
                    // 分组里的分类:收起时高度过渡到 0,展开收起都有动画
                    <div className={`prompt-cat-children ${expanded ? "" : "is-collapsed"}`} inert={!expanded}>
                      <div>
                        {newCategory?.groupId === item.id && (
                          <div className="prompt-cat-create is-child">
                            <input className="prompt-cat-rename" value={newCategory.name} maxLength={20} autoFocus
                              placeholder="分类名称，回车创建" aria-label={`在 ${item.name} 里新建分类`}
                              onChange={(event) => setNewCategory({ groupId: item.id, name: event.target.value })}
                              onFocus={() => { skipBlur.current = false; }} onBlur={createCategory}
                              onKeyDown={(event) => {
                                if (event.key === "Enter") event.currentTarget.blur();
                                if (event.key === "Escape") { event.stopPropagation(); skipBlur.current = true; setNewCategory(null); }
                              }} />
                          </div>
                        )}
                        {children.map((child) => (
                          <SortableCategory key={child.id} id={child.id} disabled={!expanded || renaming?.id === child.id}
                            className={`prompt-cat-item is-child ${overCategory === child.id ? "is-drop-target" : ""}`}>
                            {categoryRow(child)}
                          </SortableCategory>
                        ))}
                        {!children.length && !catQuery && newCategory?.groupId !== item.id && (
                          <p className="prompt-cat-empty">点「+」新建分类，或把分类拖到这里</p>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </SortableContext>
            {managing && !catManaging && selectedCategories.size > 0 && (
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
                {/* 下拉框不能放在 <label> 里:点选项时 label 会再点一次触发按钮,把列表又打开 */}
                <div className="prompt-editor-field"><span>分类</span>
                  <Dropdown className="prompt-dropdown opens-up" ariaLabel="分类" value={editingCategory}
                    options={categories.map((item) => ({ value: item.id, label: item.name }))}
                    onChange={setEditingCategory} />
                </div>
                <div className="prompt-editor-field"><span>推荐比例</span>
                  <Dropdown className="prompt-dropdown opens-up" ariaLabel="推荐比例" value={editing.ratio || NO_RATIO}
                    options={[{ value: NO_RATIO, label: "不指定" },
                      ...RATIOS.map((ratio) => ({ value: ratio, label: ratio === "adaptive" ? "智能比例" : ratio }))]}
                    onChange={(ratio) => setEditing({ ...editing, ratio: ratio === NO_RATIO ? undefined : ratio })} />
                </div>
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
                <div className="prompt-sort"><span>排序</span>
                  <Dropdown className="prompt-dropdown" ariaLabel="提示词排序" value={layout.sort}
                    options={PROMPT_SORTS.map((item) => ({ value: item.id, label: item.name }))}
                    onChange={(sort: PromptSort) => onLayoutChange({ ...layout, sort })} />
                </div>
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
                    <Dropdown className="prompt-dropdown" ariaLabel="移动到分类" placeholder="移动到…" value=""
                      disabled={!selected.size}
                      options={categories.map((item) => ({ value: item.id, label: item.name }))}
                      onChange={(target) => {
                        onLayoutChange(movePrompts(layout, templates, [...selected], target));
                        flash(`已移动 ${selected.size} 条提示词`);
                        setSelected(new Set());
                      }} />
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
