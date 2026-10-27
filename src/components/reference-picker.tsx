"use client";

import { useEffect, useState, type CSSProperties, type KeyboardEvent } from "react";
import { Check, Pencil, Sparkles, Trash2, Upload, X, ZoomIn } from "lucide-react";
import type { AssetFolder } from "@/lib/asset-store";
import type { MediaKind } from "@/lib/tangzhi";
import { MediaThumb } from "@/components/media-thumb";
import { Dropdown } from "@/components/dropdown";
import { MediaPreview, mediaPreviewItem } from "@/components/media-preview";
import { useCardDrag } from "@/components/card-drag";
import { ALL_FOLDERS, FolderBar, NEW_FOLDER, UNGROUPED } from "@/components/folder-bar";

export type PickerAsset = {
  id: string; kind: MediaKind; path: string; name: string; mimeType: string;
  folder?: string;
  /** upload:自己上传的;没有:AI 生成的 */
  source?: string;
  /** 素材库里有记录的(能改名、删除、分组);只在当前输入框里的附件为 false */
  managed: boolean;
};

/** 输入框作为拖放目标的 ID(app-shell 里输入框上的 data-drop-target) */
export const COMPOSER_DROP = "__composer__";

type Source = "all" | "upload" | "generated";
const SOURCES: [Source, string][] = [["all", "全部"], ["upload", "我上传的"], ["generated", "AI 生成"]];
const isUpload = (asset: PickerAsset) => asset.source === "upload" || asset.source === "chat" || !asset.managed;

const baseName = (name: string) => name.replace(/\.[a-z0-9]{1,6}$/i, "");

/**
 * 输入框 @ 弹出的「选择参考内容」:点一下引用素材,或者把素材拖到输入框里;
 * 按来源分栏(我上传的 / AI 生成)、按文件夹筛选;也能整理素材库——
 * 改名、放大查看、删除(移到回收站)、拖到文件夹上移动、文件夹改名 / 删除,
 * 「管理」模式下多选、全选、批量移动和删除。文件夹和资产页是同一份。
 */
export function ReferencePicker({
  style, closing = false, assets, folders, loading, isAttached, onPick, onAttach, onClose,
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
  /** 拖到输入框上:作为参考素材加进去 */
  onAttach: (assets: PickerAsset[]) => void;
  onClose: () => void;
  onRename: (path: string, name: string) => Promise<unknown>;
  onTrash: (paths: string[]) => Promise<unknown>;
  onMove: (paths: string[], folder: string | null) => Promise<unknown>;
  onCreateFolder: (name: string, paths: string[]) => Promise<AssetFolder>;
  onRenameFolder: (id: string, name: string) => Promise<unknown>;
  onDeleteFolder: (id: string) => Promise<unknown>;
}) {
  const [query, setQuery] = useState("");
  const [source, setSource] = useState<Source>("all");
  const [filter, setFilter] = useState(ALL_FOLDERS);
  const [managing, setManaging] = useState(false);
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  const [renaming, setRenaming] = useState<{ path: string; text: string }>();
  const [preview, setPreview] = useState<number | null>(null);
  // 删除要点两次:记下第一次点的是哪个(asset:路径 / batch),3 秒后复原
  const [confirm, setConfirm] = useState<string>();

  useEffect(() => {
    if (!confirm) return;
    const timer = window.setTimeout(() => setConfirm(undefined), 3000);
    return () => window.clearTimeout(timer);
  }, [confirm]);

  const folderIds = new Set(folders.map((folder) => folder.id));
  const folderOf = (asset: PickerAsset) => asset.folder && folderIds.has(asset.folder) ? asset.folder : undefined;
  // 正在看的文件夹被删掉了就回到「全部」
  const current = filter === ALL_FOLDERS || filter === UNGROUPED || folderIds.has(filter) ? filter : ALL_FOLDERS;
  const words = query.trim().toLowerCase();
  const matched = assets.filter((asset) => (!words || asset.name.toLowerCase().includes(words)) &&
    (source === "all" || (source === "upload") === isUpload(asset)));
  const inFolder = (asset: PickerAsset, id: string) => id === ALL_FOLDERS ||
    (id === UNGROUPED ? asset.managed && !folderOf(asset) : folderOf(asset) === id);
  const visible = matched.filter((asset) => inFolder(asset, current));
  const manageable = visible.filter((asset) => asset.managed);
  const pickedPaths = assets.filter((asset) => asset.managed && picked.has(asset.path)).map((asset) => asset.path);
  const allPicked = manageable.length > 0 && manageable.every((asset) => picked.has(asset.path));
  const sourceCount = (value: Source) => assets.filter((asset) => (!words || asset.name.toLowerCase().includes(words)) &&
    (value === "all" || (value === "upload") === isUpload(asset))).length;

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

  const createFolder = (name: string, paths: string[]) => run(async () => {
    const folder = await onCreateFolder(name, paths);
    setFilter(folder.id);
  });

  // ---- 拖动:管理模式下拖已选中的一张,带着全部选中的一起走;拖到输入框就作为参考素材加进去 ----
  const cardDrag = useCardDrag((target, paths) => {
    if (target === COMPOSER_DROP) {
      onAttach(paths.map((path) => assets.find((asset) => asset.path === path)).filter((asset): asset is PickerAsset => Boolean(asset)));
    } else if (target === NEW_FOLDER) createFolder(`新文件夹 ${folders.length + 1}`, paths);
    else run(() => onMove(paths, target === UNGROUPED ? null : target));
  });
  const dragPaths = (asset: PickerAsset) => managing && picked.has(asset.path) ? pickedPaths
    : asset.managed || !managing ? [asset.path] : [];

  const saveRename = () => {
    const edit = renaming;
    if (!edit) return;
    setRenaming(undefined);
    const text = edit.text.trim();
    const asset = assets.find((item) => item.path === edit.path);
    if (text && asset && text !== baseName(asset.name) && text !== asset.name) run(() => onRename(edit.path, text));
  };
  // 输入框里的 Enter / Esc 只给这个输入框(不触发外面的发送、关闭)
  const renameKeys = (event: KeyboardEvent<HTMLInputElement>) => {
    event.stopPropagation();
    if (event.nativeEvent.isComposing) return;
    if (event.key === "Enter") { event.preventDefault(); saveRename(); }
    if (event.key === "Escape") { event.preventDefault(); setRenaming(undefined); }
  };

  const trash = (paths: string[]) => run(async () => {
    await onTrash(paths);
    setPicked((items) => new Set([...items].filter((path) => !paths.includes(path))));
  });

  return <div className={`reference-picker ${managing ? "is-managing" : ""} ${closing ? "is-closing" : ""}`} role="dialog"
    aria-label="选择参考内容" style={style} inert={closing} data-drop-block>
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

    {/* 按来源分栏:自己上传的和 AI 生成的分开找 */}
    <div className="reference-source" role="tablist" aria-label="按来源">
      {SOURCES.map(([value, label]) => <button type="button" role="tab" key={value} aria-selected={source === value}
        className={source === value ? "active" : ""} onClick={() => setSource(value)}>
        {value === "upload" && <Upload size={11} />}{value === "generated" && <Sparkles size={11} />}
        {label}<i>{sourceCount(value)}</i>
      </button>)}
    </div>

    <FolderBar className="reference-folder-bar" folders={folders} active={current} onSelect={setFilter}
      countOf={(id) => matched.filter((asset) => inFolder(asset, id)).length}
      dragging={Boolean(cardDrag.drag)} dropTarget={cardDrag.dropTarget} landed={cardDrag.landed}
      onCreate={(name) => createFolder(name, [])}
      onRename={(id, name) => run(() => onRenameFolder(id, name))}
      onDelete={(ids) => {
        if (ids.includes(current)) setFilter(ALL_FOLDERS);
        run(async () => { for (const id of ids) await onDeleteFolder(id); });
      }} />

    {visible.length === 0 ? <p className="reference-picker-empty">
      {loading && !assets.length ? "正在加载素材…" : words ? "没有匹配的素材"
        : source === "upload" && current === ALL_FOLDERS ? "还没有上传的素材，在输入框里上传或拖入就会出现在这里。"
          : current === ALL_FOLDERS ? "还没有可引用的素材，先上传或拖入一个。" : "这个文件夹还没有素材，把素材拖到上面的文件夹名上即可移进来。"}</p> :
      <div className="reference-picker-grid">{visible.map((asset, index) => {
        const attached = isAttached(asset.path);
        const isPicked = managing && picked.has(asset.path);
        const deleting = confirm === `asset:${asset.path}`;
        const lifted = cardDrag.drag?.phase === "drag" && cardDrag.drag.paths.includes(asset.path);
        return <div key={asset.id}
          className={`reference-picker-item ${attached ? "selected" : ""} ${isPicked ? "picked" : ""} ${lifted ? "is-lifted" : ""}`}
          onPointerDown={(event) => {
            if (renaming?.path !== asset.path) cardDrag.begin(event, asset, dragPaths(asset));
          }}>
          <button type="button" className="reference-picker-pick" title={asset.name}
            onClick={() => {
              if (cardDrag.justDropped()) return;
              if (!managing) onPick(asset); else if (asset.managed) toggle(asset.path);
            }}>
            <span className="reference-picker-thumb"><MediaThumb media={asset} /></span>
            {renaming?.path !== asset.path && <span className="reference-picker-name">{asset.name}</span>}
          </button>
          {renaming?.path === asset.path && <input className="reference-picker-rename" autoFocus value={renaming.text}
            maxLength={300} aria-label="素材名称"
            onChange={(event) => setRenaming({ path: asset.path, text: event.target.value })}
            onBlur={saveRename} onKeyDown={renameKeys} />}
          {managing && asset.managed && <span className="reference-picker-check" aria-hidden="true">{isPicked && <Check size={11} strokeWidth={3} />}</span>}
          {!managing && renaming?.path !== asset.path && <span className="reference-picker-actions" data-no-drag>
            {asset.managed && <button type="button" title="重命名" aria-label="重命名"
              onClick={() => setRenaming({ path: asset.path, text: baseName(asset.name) })}><Pencil size={11} /></button>}
            <button type="button" title="放大查看" aria-label="放大查看" onClick={() => setPreview(index)}><ZoomIn size={11} /></button>
            {asset.managed && <button type="button" className={deleting ? "danger" : ""} title={deleting ? "再点一次删除（移到回收站）" : "删除"}
              aria-label="删除" onClick={() => {
                if (!deleting) { setConfirm(`asset:${asset.path}`); return; }
                setConfirm(undefined);
                trash([asset.path]);
              }}>{deleting ? "删除?" : <Trash2 size={11} />}</button>}
          </span>}
        </div>;
      })}</div>}

    {managing && <div className="reference-picker-bar">
      <button type="button" onClick={toggleAll} disabled={!manageable.length}>{allPicked ? "取消全选" : `全选 ${manageable.length}`}</button>
      <span className="reference-picker-bar-count">{pickedPaths.length ? <>已选 <b>{pickedPaths.length}</b></> : "点选或拖到文件夹"}</span>
      <Dropdown className="reference-move" value="" placeholder="移到文件夹" ariaLabel="移到文件夹" disabled={!pickedPaths.length}
        options={[
          ...folders.map((folder) => ({ value: folder.id, label: folder.name })),
          { value: UNGROUPED, label: "移出文件夹（未分组）" },
          { value: NEW_FOLDER, label: "＋ 新建文件夹并移入" },
        ]}
        onChange={(target) => {
          const paths = pickedPaths;
          setPicked(new Set());
          if (target === NEW_FOLDER) createFolder(`新文件夹 ${folders.length + 1}`, paths);
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
    {preview !== null && visible[preview] && <MediaPreview
      items={visible.map((asset) => mediaPreviewItem({ kind: asset.kind, path: asset.path, name: asset.name, mimeType: asset.mimeType }))}
      index={preview} onIndex={setPreview} onClose={() => setPreview(null)} />}
    {cardDrag.overlay}
  </div>;
}
