"use client";

import { useEffect, useState, type CSSProperties, type DragEvent, type KeyboardEvent } from "react";
import { Check, FolderPlus, Pencil, Trash2, X } from "lucide-react";
import type { AssetFolder } from "@/lib/asset-store";
import type { MediaKind } from "@/lib/tangzhi";
import { MediaThumb } from "@/components/media-thumb";

export type PickerAsset = {
  id: string; kind: MediaKind; path: string; name: string; mimeType: string;
  folder?: string;
  /** 素材库里有记录的(能改名、删除、分组);只在当前输入框里的附件为 false */
  managed: boolean;
};

const DRAG_TYPE = "application/x-tz-asset-paths";
const NEW_FOLDER = "__new__";
const UNGROUPED = "__none__";
/** 筛选:all 全部、UNGROUPED 未分组,其他是分组 ID */
type Filter = string;

const baseName = (name: string) => name.replace(/\.[a-z0-9]{1,6}$/i, "");

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
  const readDrag = (event: DragEvent) => {
    try {
      const value = JSON.parse(event.dataTransfer.getData(DRAG_TYPE) || "[]") as unknown;
      return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
    } catch { return []; }
  };
  const dropZone = (target: string, onDrop: (paths: string[]) => void) => ({
    onDragOver: (event: DragEvent) => {
      if (!event.dataTransfer.types.includes(DRAG_TYPE)) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
      if (dropTarget !== target) setDropTarget(target);
    },
    onDragLeave: () => setDropTarget((value) => value === target ? undefined : value),
    onDrop: (event: DragEvent) => {
      const paths = readDrag(event);
      setDropTarget(undefined);
      if (!paths.length) return;
      event.preventDefault();
      event.stopPropagation();
      onDrop(paths);
    },
  });

  const createFolder = (name: string, paths: string[]) => run(async () => {
    const folder = await onCreateFolder(name, paths);
    setFilter(folder.id);
    // 拖进来新建的先用默认名,马上进入改名
    if (paths.length) setFolderEdit({ id: folder.id, text: folder.name });
  });

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

  const folderChip = (id: string, label: string, drop?: (paths: string[]) => void) =>
    <button type="button" key={id} role="tab" aria-selected={current === id}
      className={`reference-folder ${current === id ? "active" : ""} ${dropTarget === id ? "drop" : ""}`}
      onClick={() => setFilter(id)}
      onDoubleClick={() => { if (folderIds.has(id)) setFolderEdit({ id, text: label }); }}
      title={folderIds.has(id) ? "双击改名，可把素材拖到这里" : drop ? "可把素材拖到这里" : undefined}
      {...(drop ? dropZone(id, drop) : {})}>
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
      {folderChip(UNGROUPED, "未分组", (paths) => run(() => onMove(paths, null)))}
      {folders.map((folder) => editingFolder(folder.id) ||
        folderChip(folder.id, folder.name, (paths) => run(() => onMove(paths, folder.id))))}
      {editingFolder(NEW_FOLDER) || <button type="button"
        className={`reference-folder add ${dropTarget === NEW_FOLDER ? "drop" : ""}`}
        title="新建分组（也可以把素材拖到这里）"
        onClick={() => setFolderEdit({ id: NEW_FOLDER, text: "" })}
        {...dropZone(NEW_FOLDER, (paths) => createFolder(`新分组 ${folders.length + 1}`, paths))}>
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
        return <div key={asset.id} draggable={asset.managed && renaming?.path !== asset.path}
          className={`reference-picker-item ${attached ? "selected" : ""} ${isPicked ? "picked" : ""}`}
          onDragStart={(event) => {
            event.dataTransfer.setData(DRAG_TYPE, JSON.stringify(dragPaths(asset)));
            event.dataTransfer.effectAllowed = "move";
          }}
          onDragEnd={() => setDropTarget(undefined)}>
          <button type="button" className="reference-picker-pick" title={asset.name}
            onClick={() => { if (!managing) onPick(asset); else if (asset.managed) toggle(asset.path); }}>
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
      <select value="" disabled={!pickedPaths.length} aria-label="移到分组"
        onChange={(event) => {
          const target = event.target.value;
          if (!target) return;
          run(() => onMove(pickedPaths, target === UNGROUPED ? null : target));
          setPicked(new Set());
        }}>
        <option value="">移到分组…</option>
        <option value={UNGROUPED}>未分组</option>
        {folders.map((folder) => <option key={folder.id} value={folder.id}>{folder.name}</option>)}
      </select>
      <button type="button" className={`danger-soft ${confirm === "batch" ? "danger" : ""}`} disabled={!pickedPaths.length}
        onClick={() => {
          if (confirm !== "batch") { setConfirm("batch"); return; }
          setConfirm(undefined);
          trash(pickedPaths);
        }}>
        <Trash2 size={12} />{confirm === "batch" ? `确认删除 ${pickedPaths.length} 个` : "删除"}
      </button>
    </div>}
  </div>;
}
