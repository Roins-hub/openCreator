"use client";

import { useAuiState } from "@assistant-ui/react";
import { CheckIcon, ChevronDownIcon, FolderIcon, FolderOpenIcon, FolderPlusIcon } from "lucide-react";
import { useEffect, useRef, useState, type FC } from "react";
import { MAX_THREAD_GROUPS, moveThreads, newGroupId } from "@/lib/thread-groups";
import { getThreadGroups, setThreadGroups, useThreadGroups } from "@/lib/thread-groups-store";
import { cn } from "@/lib/utils";

/**
 * 输入框里的「项目分组」(和视频工作台一致):当前聊天放在哪个分组,可以直接换或新建一个。
 * 和侧栏的分组是同一份数据;新聊天还没发消息时也能先选好分组。
 */
export const ComposerGroupPicker: FC = () => {
  const data = useThreadGroups();
  const threadId = useAuiState((s) => s.threads.mainThreadId);
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const groupId = threadId ? data.assign[threadId] : undefined;
  const current = data.groups.find((group) => group.id === groupId);

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
      // 放大编辑时 Esc 也会收起输入框:这里先拦下
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

  const choose = (next: string | undefined) => {
    close();
    if (!threadId || next === groupId) return;
    setThreadGroups(moveThreads(getThreadGroups(), [threadId], next));
  };

  const createAndChoose = () => {
    const trimmed = name.trim().slice(0, 30);
    const latest = getThreadGroups();
    if (!trimmed || !threadId || latest.groups.length >= MAX_THREAD_GROUPS) return;
    const group = { id: newGroupId(), name: trimmed };
    setThreadGroups(moveThreads({ ...latest, groups: [...latest.groups, group] }, [threadId], group.id));
    close();
  };

  return (
    <div className="chat-group-picker relative" ref={rootRef}>
      <button
        type="button"
        className={cn("chat-group-trigger flex h-7 max-w-[160px] items-center gap-1.5 rounded-full px-2 text-xs", current && "has-group", open && "is-open")}
        aria-expanded={open}
        aria-haspopup="menu"
        title={current ? `所在分组：${current.name}` : "放进项目分组"}
        onClick={() => (open ? close() : setOpen(true))}
      >
        {current ? <FolderOpenIcon className="size-3.5 shrink-0" /> : <FolderIcon className="size-3.5 shrink-0" />}
        <span className="hidden truncate sm:inline">{current?.name || "未分组"}</span>
        <ChevronDownIcon className="size-3 shrink-0 opacity-60" />
      </button>
      {open && (
        <div className="chat-group-popover" role="menu">
          <small>当前聊天放在哪个项目分组</small>
          <div className="chat-group-list">
            <button type="button" role="menuitemradio" aria-checked={!current} className={cn(!current && "is-selected")}
              onClick={() => choose(undefined)}>
              <span>未分组</span>
              {!current && <CheckIcon className="size-3.5" />}
            </button>
            {data.groups.map((group) => (
              <button type="button" key={group.id} role="menuitemradio" aria-checked={group.id === groupId}
                className={cn(group.id === groupId && "is-selected")} onClick={() => choose(group.id)}>
                <span><FolderIcon className="size-3.5 shrink-0" />{group.name}</span>
                {group.id === groupId && <CheckIcon className="size-3.5" />}
              </button>
            ))}
          </div>
          {creating ? (
            <form className="chat-group-new" onSubmit={(event) => { event.preventDefault(); createAndChoose(); }}>
              <input autoFocus maxLength={30} value={name} placeholder="分组名称" aria-label="新分组名称"
                onChange={(event) => setName(event.target.value)} />
              <button type="submit" disabled={!name.trim()}>创建</button>
            </form>
          ) : (
            <button type="button" className="chat-group-create" onClick={() => setCreating(true)}
              disabled={data.groups.length >= MAX_THREAD_GROUPS}>
              <FolderPlusIcon className="size-3.5" /> 新建分组并放入
            </button>
          )}
        </div>
      )}
    </div>
  );
};
