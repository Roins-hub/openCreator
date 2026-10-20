"use client";

import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, Folder, FolderOpen, FolderPlus } from "lucide-react";
import type { ConversationGroup } from "@/components/conversation-list";

/**
 * 输入框里的「项目分组」:当前对话放在哪个分组里,可以直接换分组或新建一个分组。
 * 分组和侧边栏里的是同一套。
 */
export function GroupPicker({ groups, value, onChange, onCreate }: {
  groups: ConversationGroup[];
  value?: string;
  onChange: (groupId: string | undefined) => void;
  onCreate: (name: string) => ConversationGroup;
}) {
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const current = groups.find((group) => group.id === value);

  const close = () => {
    setOpen(false);
    setCreating(false);
    setName("");
  };

  useEffect(() => {
    if (!open) return;
    const pointer = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) close();
    };
    const key = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      // 放大编辑时 Esc 也会收起输入框:这里先把它拦下
      event.preventDefault();
      close();
    };
    document.addEventListener("mousedown", pointer);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("mousedown", pointer);
      document.removeEventListener("keydown", key);
    };
  }, [open]);

  const choose = (groupId: string | undefined) => {
    close();
    if (groupId !== value) onChange(groupId);
  };

  const submitNew = () => {
    const trimmed = name.trim().slice(0, 30);
    if (!trimmed) return;
    choose(onCreate(trimmed).id);
  };

  return <div className="parameter-control group-picker" ref={rootRef}>
    <button type="button" className={`parameter-trigger group-trigger ${open ? "active" : ""} ${current ? "has-group" : ""}`}
      aria-expanded={open} aria-haspopup="menu" title={current ? `所在分组：${current.name}` : "放进项目分组"}
      onClick={() => (open ? close() : setOpen(true))}>
      {current ? <FolderOpen size={13} /> : <Folder size={13} />}
      <span>{current?.name || "未分组"}</span>
      <ChevronDown size={13} />
    </button>
    {open && <div className="mode-popover group-popover" role="menu">
      <small>当前对话放在哪个项目分组</small>
      <div className="group-popover-list">
        <button type="button" role="menuitemradio" aria-checked={!current} className={!current ? "selected" : ""}
          onClick={() => choose(undefined)}>
          <span><b>未分组</b></span>
          {!current && <Check size={15} />}
        </button>
        {groups.map((group) => <button type="button" key={group.id} role="menuitemradio" aria-checked={group.id === value}
          className={group.id === value ? "selected" : ""} onClick={() => choose(group.id)}>
          <span><b><Folder size={12} />{group.name}</b></span>
          {group.id === value && <Check size={15} />}
        </button>)}
      </div>
      {creating
        ? <form className="group-popover-new" onSubmit={(event) => { event.preventDefault(); submitNew(); }}>
          <input autoFocus maxLength={30} value={name} placeholder="分组名称" aria-label="新分组名称"
            onChange={(event) => setName(event.target.value)} />
          <button type="submit" disabled={!name.trim()}>创建</button>
        </form>
        : <button type="button" className="group-popover-create" onClick={() => setCreating(true)}>
          <FolderPlus size={14} /> 新建分组并放入
        </button>}
    </div>}
  </div>;
}
