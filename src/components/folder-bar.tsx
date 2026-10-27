"use client";

import { useEffect, useState, type KeyboardEvent } from "react";
import { Check, FolderPlus, ListChecks, Pencil, Trash2 } from "lucide-react";
import type { AssetFolder } from "@/lib/asset-store";

/** 「全部」「未分组」「新建文件夹」的 ID(和文件夹 ID 共用一个取值空间) */
export const ALL_FOLDERS = "all";
export const UNGROUPED = "__none__";
export const NEW_FOLDER = "__new__";

/**
 * 素材文件夹一排(@ 选择素材、资产页共用,数据是同一份):
 * 点文件夹筛选;素材拖到文件夹上就移进去(拖到「新建文件夹」直接建一个);
 * 文件夹右边的笔改名(双击也行);「管理文件夹」里多选、全选、删除(里面的素材不删,回到未分组)。
 * 文件夹多了自动换行,不会挤出去。
 */
export function FolderBar({
  folders, active, onSelect, countOf, dragging = false, dropTarget, landed, onCreate, onRename, onDelete, className = "",
}: {
  folders: AssetFolder[];
  active: string;
  onSelect: (id: string) => void;
  countOf: (id: string) => number;
  /** 正在拖素材:能放的文件夹虚线提示 */
  dragging?: boolean;
  dropTarget?: string;
  landed?: string;
  onCreate: (name: string) => void;
  onRename: (id: string, name: string) => void;
  onDelete: (ids: string[]) => void;
  className?: string;
}) {
  const [edit, setEdit] = useState<{ id: string; text: string }>();
  const [managing, setManaging] = useState(false);
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  const [confirming, setConfirming] = useState(false);
  useEffect(() => {
    if (!confirming) return;
    const timer = window.setTimeout(() => setConfirming(false), 3000);
    return () => window.clearTimeout(timer);
  }, [confirming]);

  const ids = new Set(folders.map((folder) => folder.id));
  const chosen = [...picked].filter((id) => ids.has(id));
  const allChosen = folders.length > 0 && chosen.length === folders.length;

  const save = () => {
    const current = edit;
    if (!current) return;
    setEdit(undefined);
    const text = current.text.trim().slice(0, 40);
    if (!text) return;
    if (current.id === NEW_FOLDER) onCreate(text);
    else if (folders.find((folder) => folder.id === current.id)?.name !== text) onRename(current.id, text);
  };
  // 输入框里的 Enter / Esc 只给这个输入框(不触发外面的发送、关闭)
  const keys = (event: KeyboardEvent<HTMLInputElement>) => {
    event.stopPropagation();
    if (event.nativeEvent.isComposing) return;
    if (event.key === "Enter") { event.preventDefault(); save(); }
    if (event.key === "Escape") { event.preventDefault(); setEdit(undefined); }
  };
  const editor = (id: string) => edit !== undefined && edit.id === id && <input key={`edit-${id}`} className="folder-chip-input" autoFocus
    value={edit.text} maxLength={40} placeholder="文件夹名称" aria-label="文件夹名称"
    onChange={(event) => setEdit({ id, text: event.target.value })} onBlur={save} onKeyDown={keys} />;

  const toggle = (id: string) => setPicked((current) => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const stopManaging = () => { setManaging(false); setPicked(new Set()); setConfirming(false); };

  const chip = (id: string, label: string, droppable: boolean) => {
    const folder = ids.has(id);
    const isPicked = managing && folder && picked.has(id);
    return <div key={id} data-drop-target={droppable ? id : undefined}
      className={`folder-chip ${active === id ? "active" : ""} ${dropTarget === id ? "drop" : ""} ${dragging && droppable ? "can-drop" : ""} ${landed === id ? "landed" : ""} ${isPicked ? "picked" : ""} ${folder ? "is-folder" : ""}`}>
      <button type="button" role="tab" aria-selected={active === id} className="folder-chip-main"
        title={folder ? (managing ? "点击选择" : "双击或点右边的笔改名，可把素材拖到这里") : droppable ? "可把素材拖到这里" : undefined}
        onClick={() => { if (managing && folder) toggle(id); else onSelect(id); }}
        onDoubleClick={() => { if (folder && !managing) setEdit({ id, text: label }); }}>
        {managing && folder && <span className="folder-chip-check" aria-hidden="true">{isPicked && <Check size={10} strokeWidth={3} />}</span>}
        {label}<i>{countOf(id)}</i>
      </button>
      {folder && !managing && <button type="button" className="folder-chip-edit" title="重命名" aria-label={`重命名文件夹 ${label}`}
        onClick={() => setEdit({ id, text: label })}><Pencil size={11} /></button>}
    </div>;
  };

  return <div className={`folder-bar ${managing ? "is-managing" : ""} ${className}`}>
    <div className="folder-bar-row" role="tablist" aria-label="素材文件夹">
      {chip(ALL_FOLDERS, "全部", false)}
      {chip(UNGROUPED, "未分组", true)}
      {folders.map((folder) => editor(folder.id) || chip(folder.id, folder.name, true))}
      {editor(NEW_FOLDER) || (!managing && <div data-drop-target={NEW_FOLDER}
        className={`folder-chip add ${dropTarget === NEW_FOLDER ? "drop" : ""} ${dragging ? "can-drop" : ""} ${landed === NEW_FOLDER ? "landed" : ""}`}>
        <button type="button" className="folder-chip-main" title="新建文件夹（也可以把素材拖到这里）"
          onClick={() => setEdit({ id: NEW_FOLDER, text: "" })}><FolderPlus size={12} />新建文件夹</button>
      </div>)}
      {folders.length > 0 && <button type="button" className={`folder-bar-manage ${managing ? "active" : ""}`}
        onClick={() => (managing ? stopManaging() : setManaging(true))}>
        <ListChecks size={12} />{managing ? "完成" : "管理文件夹"}
      </button>}
    </div>
    {managing && <div className="folder-bar-tools">
      <button type="button" onClick={() => setPicked(allChosen ? new Set() : new Set(folders.map((folder) => folder.id)))}>
        {allChosen ? "取消全选" : `全选 ${folders.length}`}
      </button>
      <span>{chosen.length ? <>已选 <b>{chosen.length}</b> 个文件夹</> : "点文件夹选择"}</span>
      <button type="button" className={`danger-soft ${confirming ? "danger" : ""}`} disabled={!chosen.length}
        title="删除文件夹，里面的素材不会删除，回到「未分组」"
        onClick={() => {
          if (!confirming) { setConfirming(true); return; }
          onDelete(chosen);
          stopManaging();
        }}>
        <Trash2 size={12} />{confirming ? `确认删除 ${chosen.length} 个文件夹` : "删除"}
      </button>
    </div>}
  </div>;
}
