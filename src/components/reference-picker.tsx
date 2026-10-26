"use client";

import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import { createPortal } from "react-dom";
import { Check, FolderPlus, Pencil, Trash2, X } from "lucide-react";
import type { AssetFolder } from "@/lib/asset-store";
import type { MediaKind } from "@/lib/tangzhi";
import { MediaThumb } from "@/components/media-thumb";
import { Dropdown } from "@/components/dropdown";

export type PickerAsset = {
  id: string; kind: MediaKind; path: string; name: string; mimeType: string;
  folder?: string;
  /** 素材库里有记录的(能改名、删除、分组);只在当前输入框里的附件为 false */
  managed: boolean;
};

const NEW_FOLDER = "__new__";
const UNGROUPED = "__none__";
/** 筛选:all 全部、UNGROUPED 未分组,其他是分组 ID */
type Filter = string;

const baseName = (name: string) => name.replace(/\.[a-z0-9]{1,6}$/i, "");

/** 拖动中的卡片:跟着鼠标走;移到分组上时被吸过去并缩小,松手后飞进分组(drop)或飞回原处(cancel) */
type CardDrag = {
  paths: string[];
  asset: PickerAsset;
  x: number; y: number;
  /** 按下的位置相对卡片左上角的偏移(卡片不跳到鼠标中心) */
  grabX: number; grabY: number;
  origin: { left: number; top: number; width: number };
  target?: string;
  /** 吸附的分组标签:中心点和上沿(吸附时卡片停在标签正上方,不挡住标签;松手时飞进中心) */
  anchor?: { x: number; y: number; top: number };
  phase: "drag" | "drop" | "cancel";
};
const DRAG_THRESHOLD = 6;
const targetAt = (x: number, y: number) => {
  const element = document.elementFromPoint?.(x, y) as HTMLElement | null;
  const target = element?.closest<HTMLElement>("[data-drop-target]");
  if (!target?.dataset.dropTarget) return undefined;
  const rect = target.getBoundingClientRect();
  return { id: target.dataset.dropTarget, anchor: { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, top: rect.top } };
};

/**
 * 输入框 @ 弹出的「选择参考内容」:点一下引用素材;也能在这里整理素材库——
 * 改名、删除(移到回收站)、拖到分组上移动(拖到「新建分组」直接建一个)、分组改名 / 删除,
 * 「管理」模式下多选、全选、批量移动和删除。
 */
export function ReferencePicker({
  style, closing = false, assets, folders, loading, isAttached, onPick, onClose,
  onRename, onTrash, onMove, onCreateFolder, onRenameFolder, onDeleteFolder,
}: {
  style: CSSProperties;
  /** 正在收起(播放收起动画) */
  closing?: boolean;
  assets: PickerAsset[];
  folders: AssetFolder[];
  loading: boolean;
  isAttached: (path: string) => boolean;
  onPick: (asset: PickerAsset) => void;
  onClose: () => void;
  onRename: (path: string, name: string) => Promise<unknown>;
  onTrash: (paths: string[]) => Promise<unknown>;
  onMove: (paths: string[], folder: string | null) => Promise<unknown>;
  onCreateFolder: (name: string, paths: string[]) => Promise<AssetFolder>;
  onRenameFolder: (id: string, name: string) => Promise<unknown>;
  onDeleteFolder: (id: string) => Promise<unknown>;
}) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [managing, setManaging] = useState(false);
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  const [renaming, setRenaming] = useState<{ path: string; text: string }>();
  const [folderEdit, setFolderEdit] = useState<{ id: string; text: string }>();
  // 删除要点两次:记下第一次点的是哪个(asset:路径 / folder:ID / batch),3 秒后复原
  const [confirm, setConfirm] = useState<string>();
  const [dropTarget, setDropTarget] = useState<string>();
  const [drag, setDrag] = useState<CardDrag>();
  // 刚放进去的分组:播放一下「吞下」的回弹
  const [landed, setLanded] = useState<string>();
  // 拖完松手后浏览器还会补一个 click,别把它当成「选中素材」:记下松手的时间,紧跟着的 click 跳过
  const suppressClickRef = useRef(0);

  useEffect(() => {
    if (!confirm) return;
    const timer = window.setTimeout(() => setConfirm(undefined), 3000);
    return () => window.clearTimeout(timer);
  }, [confirm]);

  const folderIds = new Set(folders.map((folder) => folder.id));
  const folderOf = (asset: PickerAsset) => asset.folder && folderIds.has(asset.folder) ? asset.folder : undefined;
  // 正在看的分组被删掉了就回到「全部」
  const current = filter === "all" || filter === UNGROUPED || folderIds.has(filter) ? filter : "all";
  const words = query.trim().toLowerCase();
  const matched = assets.filter((asset) => !words || asset.name.toLowerCase().includes(words));
  const visible = matched.filter((asset) => current === "all" ||
    (current === UNGROUPED ? asset.managed && !folderOf(asset) : folderOf(asset) === current));
  const manageable = visible.filter((asset) => asset.managed);
  const pickedPaths = assets.filter((asset) => asset.managed && picked.has(asset.path)).map((asset) => asset.path);
  const allPicked = manageable.length > 0 && manageable.every((asset) => picked.has(asset.path));
  const countIn = (id: string) => matched.filter((asset) => id === UNGROUPED ? asset.managed && !folderOf(asset) : folderOf(asset) === id).length;

  // 出错时外面已经提示了,这里只是不让未处理的 Promise 报错
  const run = (task: () => Promise<unknown>) => { void task().catch(() => undefined); };

  const toggle = (path: string) => setPicked((items) => {
    const next = new Set(items);
    if (next.has(path)) next.delete(path); else next.add(path);
    return next;
  });
  const toggleAll = () => setPicked((items) => {
    const next = new Set(items);
    manageable.forEach((asset) => { if (allPicked) next.delete(asset.path); else next.add(asset.path); });
    return next;
  });

  // ---- 拖动:管理模式下拖已选中的一张,带着全部选中的一起走 ----
  const dragPaths = (asset: PickerAsset) => managing && picked.has(asset.path) ? pickedPaths : [asset.path];
  const createFolder = (name: string, paths: string[]) => run(async () => {
    const folder = await onCreateFolder(name, paths);
    setFilter(folder.id);
    // 拖进来新建的先用默认名,马上进入改名
    if (paths.length) setFolderEdit({ id: folder.id, text: folder.name });
  });

  const dropOn = (target: string, paths: string[]) => {
    if (target === NEW_FOLDER) createFolder(`新分组 ${folders.length + 1}`, paths);
    else run(() => onMove(paths, target === UNGROUPED ? null : target));
  };

  /**
   * 按住素材拖动(鼠标 / 触控笔;手指保留滚动)。移动超过几像素才算拖动,
   * 卡片挂在 body 上跟着鼠标走,下面是哪个分组由 data-drop-target 判断。
   */
  const beginDrag = (event: ReactPointerEvent<HTMLDivElement>, asset: PickerAsset) => {
    if (event.button !== 0 || event.pointerType === "touch" || !asset.managed || renaming?.path === asset.path) return;
    if ((event.target as HTMLElement).closest(".reference-picker-actions, input")) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const startX = event.clientX;
    const startY = event.clientY;
    const paths = dragPaths(asset);
    let started = false;
    let target: string | undefined;
    const base = {
      paths, asset, grabX: startX - rect.left, grabY: startY - rect.top,
      origin: { left: rect.left, top: rect.top, width: rect.width },
    };
    const finish = (dropped: boolean) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancel);
      window.removeEventListener("keydown", key, true);
      document.body.classList.remove("is-card-dragging");
      if (!started) return;
      suppressClickRef.current = Date.now();
      setDropTarget(undefined);
      const into = dropped ? target : undefined;
      setDrag((current) => current && { ...current, phase: into ? "drop" : "cancel" });
      if (into) {
        dropOn(into, paths);
        setLanded(into);
        window.setTimeout(() => setLanded((value) => value === into ? undefined : value), 520);
      }
      window.setTimeout(() => setDrag(undefined), 280);
    };
    const move = (moved: PointerEvent) => {
      if (!started) {
        if (Math.hypot(moved.clientX - startX, moved.clientY - startY) < DRAG_THRESHOLD) return;
        started = true;
        document.body.classList.add("is-card-dragging");
      }
      const hit = targetAt(moved.clientX, moved.clientY);
      target = hit?.id;
      setDropTarget(target);
      setDrag({ ...base, x: moved.clientX, y: moved.clientY, target, anchor: hit?.anchor, phase: "drag" });
    };
    const up = () => finish(true);
    const cancel = () => finish(false);
    const key = (pressed: globalThis.KeyboardEvent) => {
      if (pressed.key !== "Escape" || !started) return;
      pressed.preventDefault();
      pressed.stopPropagation();
      finish(false);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", cancel);
    window.addEventListener("keydown", key, true);
  };

  const saveFolderEdit = () => {
    const edit = folderEdit;
    if (!edit) return;
    setFolderEdit(undefined);
    const text = edit.text.trim();
    if (!text) return;
    if (edit.id === NEW_FOLDER) createFolder(text, []);
    else if (folders.find((folder) => folder.id === edit.id)?.name !== text) run(() => onRenameFolder(edit.id, text));
  };
  const saveRename = () => {
    const edit = renaming;
    if (!edit) return;
    setRenaming(undefined);
    const text = edit.text.trim();
    const asset = assets.find((item) => item.path === edit.path);
    if (text && asset && text !== baseName(asset.name) && text !== asset.name) run(() => onRename(edit.path, text));
  };
  // 输入框里的 Enter / Esc 只给这个输入框(不触发外面的发送、关闭)
  const editKeys = (save: () => void, cancel: () => void) => (event: KeyboardEvent<HTMLInputElement>) => {
    event.stopPropagation();
    if (event.key === "Enter") { event.preventDefault(); save(); }
    if (event.key === "Escape") { event.preventDefault(); cancel(); }
  };

  const trash = (paths: string[]) => run(async () => {
    await onTrash(paths);
    setPicked((items) => new Set([...items].filter((path) => !paths.includes(path))));
  });

  const folderChip = (id: string, label: string, droppable = false) =>
    <button type="button" key={id} role="tab" aria-selected={current === id}
      className={`reference-folder ${current === id ? "active" : ""} ${dropTarget === id ? "drop" : ""} ${drag && droppable ? "can-drop" : ""} ${landed === id ? "landed" : ""}`}
      onClick={() => setFilter(id)}
      onDoubleClick={() => { if (folderIds.has(id)) setFolderEdit({ id, text: label }); }}
      title={folderIds.has(id) ? "双击改名，可把素材拖到这里" : droppable ? "可把素材拖到这里" : undefined}
      data-drop-target={droppable ? id : undefined}>
      {label}<i>{id === "all" ? matched.length : countIn(id)}</i>
    </button>;

  const editingFolder = (id: string) => folderEdit?.id === id && <input key={`edit-${id}`} className="reference-folder-input" autoFocus
    value={folderEdit.text} maxLength={40} placeholder="分组名称" aria-label="分组名称"
    onChange={(event) => setFolderEdit({ id, text: event.target.value })}
    onBlur={saveFolderEdit} onKeyDown={editKeys(saveFolderEdit, () => setFolderEdit(undefined))} />;

  const activeFolder = folders.find((folder) => folder.id === current);

  return <div className={`reference-picker ${managing ? "is-managing" : ""} ${closing ? "is-closing" : ""}`} role="dialog"
    aria-label="选择参考内容" style={style} inert={closing}>
    <div className="reference-picker-head">
      <strong>选择参考内容</strong>
      <span className="reference-picker-head-actions">
        <button type="button" className={`reference-picker-manage ${managing ? "active" : ""}`}
          onClick={() => { setManaging((value) => !value); setPicked(new Set()); setConfirm(undefined); }}>
          {managing ? "完成" : "管理"}
        </button>
        <button className="icon-button" onClick={onClose} aria-label="关闭"><X size={15} /></button>
      </span>
    </div>
    <input className="reference-picker-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索参考内容" autoFocus />

    <div className="reference-folders" role="tablist" aria-label="素材分组">
      {folderChip("all", "全部")}
      {folderChip(UNGROUPED, "未分组", true)}
      {folders.map((folder) => editingFolder(folder.id) || folderChip(folder.id, folder.name, true))}
      {editingFolder(NEW_FOLDER) || <button type="button"
        className={`reference-folder add ${dropTarget === NEW_FOLDER ? "drop" : ""} ${drag ? "can-drop" : ""} ${landed === NEW_FOLDER ? "landed" : ""}`}
        title="新建分组（也可以把素材拖到这里）"
        onClick={() => setFolderEdit({ id: NEW_FOLDER, text: "" })}
        data-drop-target={NEW_FOLDER}>
        <FolderPlus size={12} />新建分组
      </button>}
    </div>
    {activeFolder && !folderEdit && <div className="reference-folder-tools">
      <span>分组「{activeFolder.name}」</span>
      <button type="button" onClick={() => setFolderEdit({ id: activeFolder.id, text: activeFolder.name })}><Pencil size={11} />改名</button>
      <button type="button" className={confirm === `folder:${activeFolder.id}` ? "danger" : ""}
        title="删除分组（里面的素材回到未分组，不会删除）"
        onClick={() => {
          if (confirm !== `folder:${activeFolder.id}`) { setConfirm(`folder:${activeFolder.id}`); return; }
          setConfirm(undefined);
          setFilter("all");
          run(() => onDeleteFolder(activeFolder.id));
        }}><Trash2 size={11} />{confirm === `folder:${activeFolder.id}` ? "再点一次删除分组" : "删除分组"}</button>
    </div>}

    {visible.length === 0 ? <p className="reference-picker-empty">
      {loading && !assets.length ? "正在加载素材…" : words ? "没有匹配的素材" : current === "all"
        ? "还没有可引用的素材，先上传或拖入一个。" : "这个分组还没有素材，把素材拖到上面的分组名上即可移进来。"}</p> :
      <div className="reference-picker-grid">{visible.map((asset) => {
        const attached = isAttached(asset.path);
        const isPicked = managing && picked.has(asset.path);
        const deleting = confirm === `asset:${asset.path}`;
        const lifted = drag?.phase === "drag" && drag.paths.includes(asset.path);
        return <div key={asset.id}
          className={`reference-picker-item ${attached ? "selected" : ""} ${isPicked ? "picked" : ""} ${asset.managed ? "is-movable" : ""} ${lifted ? "is-lifted" : ""}`}
          onPointerDown={(event) => beginDrag(event, asset)}>
          <button type="button" className="reference-picker-pick" title={asset.name}
            onClick={() => {
              if (Date.now() - suppressClickRef.current < 400) return;
              if (!managing) onPick(asset); else if (asset.managed) toggle(asset.path);
            }}>
            <span className="reference-picker-thumb"><MediaThumb media={asset} /></span>
            {renaming?.path !== asset.path && <span className="reference-picker-name">{asset.name}</span>}
          </button>
          {renaming?.path === asset.path && <input className="reference-picker-rename" autoFocus value={renaming.text}
            maxLength={300} aria-label="素材名称"
            onChange={(event) => setRenaming({ path: asset.path, text: event.target.value })}
            onBlur={saveRename} onKeyDown={editKeys(saveRename, () => setRenaming(undefined))} />}
          {managing && asset.managed && <span className="reference-picker-check" aria-hidden="true">{isPicked && <Check size={11} strokeWidth={3} />}</span>}
          {!managing && asset.managed && renaming?.path !== asset.path && <span className="reference-picker-actions">
            <button type="button" title="重命名" aria-label="重命名"
              onClick={() => setRenaming({ path: asset.path, text: baseName(asset.name) })}><Pencil size={11} /></button>
            <button type="button" className={deleting ? "danger" : ""} title={deleting ? "再点一次删除（移到回收站）" : "删除"}
              aria-label="删除" onClick={() => {
                if (!deleting) { setConfirm(`asset:${asset.path}`); return; }
                setConfirm(undefined);
                trash([asset.path]);
              }}>{deleting ? "删除?" : <Trash2 size={11} />}</button>
          </span>}
        </div>;
      })}</div>}

    {managing && <div className="reference-picker-bar">
      <button type="button" onClick={toggleAll} disabled={!manageable.length}>{allPicked ? "取消全选" : `全选 ${manageable.length}`}</button>
      <span className="reference-picker-bar-count">{pickedPaths.length ? <>已选 <b>{pickedPaths.length}</b></> : "点选或拖到分组"}</span>
      <Dropdown className="reference-move" value="" placeholder="移到分组" ariaLabel="移到分组" disabled={!pickedPaths.length}
        options={[
          ...folders.map((folder) => ({ value: folder.id, label: folder.name })),
          { value: UNGROUPED, label: "移出分组（未分组）" },
          { value: NEW_FOLDER, label: "＋ 新建分组并移入" },
        ]}
        onChange={(target) => {
          const paths = pickedPaths;
          setPicked(new Set());
          if (target === NEW_FOLDER) createFolder(`新分组 ${folders.length + 1}`, paths);
          else run(() => onMove(paths, target === UNGROUPED ? null : target));
        }} />
      <button type="button" className={`danger-soft ${confirm === "batch" ? "danger" : ""}`} disabled={!pickedPaths.length}
        onClick={() => {
          if (confirm !== "batch") { setConfirm("batch"); return; }
          setConfirm(undefined);
          trash(pickedPaths);
        }}>
        <Trash2 size={12} />{confirm === "batch" ? `确认删除 ${pickedPaths.length} 个` : "删除"}
      </button>
    </div>}
    {drag && typeof document !== "undefined" && createPortal(<DragCard drag={drag} />, document.body)}
  </div>;
}

/**
 * 拖动中的卡片。外层管位置(跟手;到了分组上方被吸向分组中心,带一点弹性),
 * 内层管姿态(拿起时微微倾斜放大;吸附时缩小摆正;放进分组时缩没;取消时飞回原处)。
 */
function DragCard({ drag }: { drag: CardDrag }) {
  const { origin, phase } = drag;
  const free = { x: drag.x - drag.grabX, y: drag.y - drag.grabY };
  const half = origin.width / 2;
  // 吸附:卡片缩小后停在分组标签正上方(不挡住放大的标签),只保留一点点跟手的偏移
  const SNAP_SCALE = .46;
  const snapped = drag.anchor && {
    x: drag.anchor.x + (drag.x - drag.anchor.x) * .12 - half,
    y: drag.anchor.top - 10 - origin.width * SNAP_SCALE / 2 - half + (drag.y - drag.anchor.y) * .08,
  };
  const position = phase === "cancel" ? { x: origin.left, y: origin.top }
    : phase === "drop" && drag.anchor ? { x: drag.anchor.x - half, y: drag.anchor.y - half }
      : snapped || free;
  const state = phase === "drag" ? (snapped ? "is-snapped" : "is-free") : `is-${phase}`;
  // 换了吸附目标时重新挂载内层,再播一次「被吸住」的弹跳
  return <div className={`reference-drag-card ${state}`} aria-hidden="true"
    style={{ width: origin.width, transform: `translate3d(${position.x}px, ${position.y}px, 0)` }}>
    <div key={phase === "drag" ? drag.target || "free" : "end"} className={`reference-drag-card-body ${drag.paths.length > 1 ? "is-stack" : ""}`}>
      <span className="reference-picker-thumb"><MediaThumb media={drag.asset} /></span>
      <span className="reference-picker-name">{drag.asset.name}</span>
      {drag.paths.length > 1 && <b className="reference-drag-count">{drag.paths.length}</b>}
    </div>
  </div>;
}
