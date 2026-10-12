"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Check, ChevronLeft, Folder, FolderInput, FolderMinus, MoreHorizontal, Pencil, Trash2 } from "lucide-react";

export function HistoryMenu({
  title,
  onDelete,
  onRename,
  groups,
  groupId,
  onMove,
}: {
  title: string;
  onDelete: () => void;
  onRename?: (title: string) => void;
  /** 可移入的分组;传了 onMove 才显示「移到分组」 */
  groups?: { id: string; name: string }[];
  groupId?: string;
  onMove?: (groupId: string | undefined) => void;
}) {
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [moving, setMoving] = useState(false);
  const [nextTitle, setNextTitle] = useState(title);
  const rootRef = useRef<HTMLDivElement>(null);

  const close = useCallback(() => {
    setOpen(false);
    setConfirming(false);
    setRenaming(false);
    setMoving(false);
    setNextTitle(title);
  }, [title]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) close();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, close]);

  const saveName = () => {
    const value = nextTitle.trim();
    if (!value) return;
    close();
    onRename?.(value);
  };

  return <div className={`history-menu ${open ? "is-open" : ""}`} ref={rootRef}>
    <button type="button" className="history-more"
      aria-label={`${title}的更多操作`} aria-expanded={open}
      onClick={(event) => {
        event.stopPropagation();
        if (open) close();
        else setOpen(true);
      }}>
      <MoreHorizontal size={16} />
    </button>
    {open && <div className="history-popover" onClick={(event) => event.stopPropagation()}>
      {renaming ? <div className="history-rename">
        <label htmlFor={`rename-${title}`}>新的对话名称</label>
        <input id={`rename-${title}`} autoFocus maxLength={60} value={nextTitle}
          onChange={(event) => setNextTitle(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") saveName();
          }} />
        <div>
          <button type="button" onClick={() => setRenaming(false)}>取消重命名</button>
          <button type="button" className="primary" aria-label="保存名称"
            disabled={!nextTitle.trim()} onClick={saveName}>保存</button>
        </div>
      </div> : confirming ? <div className="history-confirm">
        <strong>确定删除？</strong>
        <span>此操作无法撤销</span>
        <div>
          <button type="button" onClick={() => setConfirming(false)}>取消删除</button>
          <button type="button" className="danger"
            aria-label={`确认删除${title}`}
            onClick={() => { close(); onDelete(); }}>删除</button>
        </div>
      </div> : moving ? <div className="history-move">
        <button type="button" className="history-action history-back" onClick={() => setMoving(false)}>
          <ChevronLeft size={14} /> 移到分组
        </button>
        {groups?.length ? groups.map((group) => (
          <button type="button" key={group.id} className="history-action" disabled={group.id === groupId}
            onClick={() => { close(); onMove?.(group.id); }}>
            <Folder size={14} /> <span>{group.name}</span>{group.id === groupId && <Check size={13} />}
          </button>
        )) : <p className="history-hint">还没有分组，点侧栏「对话」右边的文件夹图标新建。</p>}
        {groupId && <button type="button" className="history-action" onClick={() => { close(); onMove?.(undefined); }}>
          <FolderMinus size={14} /> 移出分组
        </button>}
      </div> : <>
        <button type="button" className="history-action"
          onClick={() => { setNextTitle(title); setRenaming(true); }}>
          <Pencil size={14} /> 重命名
        </button>
        {onMove && <button type="button" className="history-action" onClick={() => setMoving(true)}>
          <FolderInput size={14} /> 移到分组
        </button>}
        <button type="button" className="history-action history-delete"
          onClick={() => setConfirming(true)}>
          <Trash2 size={14} /> 删除对话
        </button>
      </>}
    </div>}
  </div>;
}
