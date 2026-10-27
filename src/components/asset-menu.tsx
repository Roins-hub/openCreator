"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { MoreHorizontal, Pencil, RotateCcw, Trash2, XCircle } from "lucide-react";

export function AssetMenu({
  name,
  trashed,
  onTrash,
  onRestore,
  onPermanentDelete,
  onRename,
}: {
  name: string;
  trashed: boolean;
  onTrash: () => void;
  onRestore: () => void;
  onPermanentDelete: () => void;
  /** 改名(回收站里的不显示) */
  onRename?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const close = useCallback(() => {
    setOpen(false);
    setConfirming(false);
  }, []);

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

  return <div className={`asset-menu ${open ? "is-open" : ""}`} ref={rootRef}>
    <button type="button" className="asset-more"
      aria-label={`${name} 的更多操作`} aria-expanded={open}
      onClick={() => {
        if (open) close();
        else setOpen(true);
      }}>
      <MoreHorizontal size={16} />
    </button>
    {open && <div className="asset-popover">
      {confirming ? <div className="asset-confirm">
        <strong>永久删除？</strong>
        <span>文件将从本机彻底删除，无法恢复</span>
        <div>
          <button type="button" onClick={() => setConfirming(false)}>取消</button>
          <button type="button" className="danger"
            aria-label={`确认永久删除 ${name}`}
            onClick={() => { close(); onPermanentDelete(); }}>永久删除</button>
        </div>
      </div> : <>
        {onRename && !trashed && <button type="button" className="asset-action"
          onClick={() => { close(); onRename(); }}>
          <Pencil size={14} /> 重命名
        </button>}
        {trashed ? <button type="button" className="asset-action"
          onClick={() => { close(); onRestore(); }}>
          <RotateCcw size={14} /> 恢复
        </button> : <button type="button" className="asset-action"
          onClick={() => { close(); onTrash(); }}>
          <Trash2 size={14} /> 移入回收站
        </button>}
        <button type="button" className="asset-action asset-delete"
          onClick={() => setConfirming(true)}>
          <XCircle size={14} /> 永久删除
        </button>
      </>}
    </div>}
  </div>;
}
