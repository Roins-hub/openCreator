"use client";

import { useAui, useAuiState } from "@assistant-ui/react";
import {
  CheckIcon, ChevronDownIcon, ChevronRightIcon, CornerDownRightIcon, FolderIcon, FolderOpenIcon, FolderPlusIcon, InboxIcon,
  MessageSquarePlusIcon,
} from "lucide-react";
import { useEffect, useRef, useState, type FC } from "react";
import { useSlidingIndicator } from "@/components/assistant-ui/sliding-indicator";
import { openChat, startChatInGroup } from "@/lib/chat-group-nav";
import { MAX_THREAD_GROUPS, moveThreads, newGroupId } from "@/lib/thread-groups";
import { getThreadGroups, setThreadGroups, useThreadGroups } from "@/lib/thread-groups-store";
import { cn } from "@/lib/utils";

const CLOSE_MS = 150;
/** 「未分组」在列表里的 ID */
const UNGROUPED = "";

/**
 * 输入框里的「文件夹 / 聊天」选择(和视频工作台一致):先选文件夹,再选里面的聊天或在这个文件夹里新开一个,
 * 接下来发的消息就进这个聊天;输入框里写了一半的内容会跟过去。和侧栏的分组是同一份数据。
 */
export const ComposerGroupPicker: FC = () => {
  const aui = useAui();
  const data = useThreadGroups();
  const mainThreadId = useAuiState((s) => s.threads.mainThreadId);
  const newThreadId = useAuiState((s) => s.threads.newThreadId);
  const threadIds = useAuiState((s) => s.threads.threadIds);
  const threadItems = useAuiState((s) => s.threads.threadItems);
  const [open, setOpen] = useState(false);
  const [closing, setClosing] = useState(false);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const { containerRef: foldersRef, indicator } = useSlidingIndicator<HTMLDivElement>(":scope > .is-selected");

  const groupIds = new Set(data.groups.map((group) => group.id));
  const groupOf = (id?: string) => {
    const assigned = id ? data.assign[id] : undefined;
    return assigned && groupIds.has(assigned) ? assigned : UNGROUPED;
  };
  const activeGroup = groupOf(mainThreadId);
  const [browsing, setBrowsing] = useState(activeGroup);
  const current = data.groups.find((group) => group.id === activeGroup);
  const titles = new Map(threadItems.map((item) => [item.id, item.title]));
  // 还没发过消息的新聊天不在列表里:当前就是它时也列出来
  const listed = threadIds.includes(mainThreadId) || !mainThreadId ? threadIds : [mainThreadId, ...threadIds];
  const members = listed.filter((id) => groupOf(id) === browsing);
  const countIn = (groupId: string) => listed.filter((id) => groupOf(id) === groupId).length;
  const titleOf = (id: string) => titles.get(id) || "新聊天";
  const browsingName = browsing ? data.groups.find((group) => group.id === browsing)?.name || "" : "未分组";
  // 当前就是还没发过消息的新聊天,而且就在这个文件夹:同一时间只能有一个空的新聊天,
  // 再点新建不会另开一个,所以按钮改成「直接输入」(在别的文件夹点,会把它挪过去)
  const freshHere = Boolean(mainThreadId) && mainThreadId === newThreadId && activeGroup === browsing;

  const close = () => {
    setClosing(true);
    window.setTimeout(() => {
      setOpen(false);
      setClosing(false);
      setCreating(false);
      setName("");
    }, CLOSE_MS);
  };
  const toggle = () => {
    if (open) { close(); return; }
    setBrowsing(activeGroup);
    setOpen(true);
  };

  useEffect(() => {
    if (!open || closing) return;
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
  });

  const createGroup = () => {
    const trimmed = name.trim().slice(0, 30);
    const latest = getThreadGroups();
    if (!trimmed || latest.groups.length >= MAX_THREAD_GROUPS) return;
    const group = { id: newGroupId(), name: trimmed };
    setThreadGroups({ ...latest, groups: [...latest.groups, group] });
    setCreating(false);
    setName("");
    setBrowsing(group.id);
  };

  const moveCurrent = () => {
    close();
    if (mainThreadId) setThreadGroups(moveThreads(getThreadGroups(), [mainThreadId], browsing || undefined));
  };

  return (
    <div className="chat-group-picker relative" ref={rootRef}>
      <button
        type="button"
        className={cn("chat-group-trigger flex h-7 max-w-[260px] items-center gap-1.5 rounded-full px-2 text-xs", current && "has-group", open && "is-open")}
        aria-expanded={open}
        aria-haspopup="dialog"
        title={`${current?.name || "未分组"} / ${titleOf(mainThreadId)}：选择消息发到哪个文件夹的哪个聊天`}
        onClick={toggle}
      >
        {current ? <FolderOpenIcon className="size-3.5 shrink-0" /> : <FolderIcon className="size-3.5 shrink-0" />}
        <span className="hidden truncate sm:inline">{current?.name || "未分组"}</span>
        <i className="chat-group-trigger-sep hidden sm:block" />
        <span className="chat-group-trigger-chat hidden truncate sm:inline">{titleOf(mainThreadId)}</span>
        <ChevronDownIcon className="size-3 shrink-0 opacity-60" />
      </button>
      {open && (
        <div className={cn("chat-group-popover", closing && "is-closing")} role="dialog" aria-label="选择文件夹和聊天">
          <div className="chat-group-cols">
            <div className="chat-group-folders" role="listbox" aria-label="文件夹" ref={foldersRef}>
              {indicator}
              <small>文件夹</small>
              {[{ id: UNGROUPED, name: "未分组" }, ...data.groups].map((group) => (
                <button type="button" key={group.id || "ungrouped"} role="option" aria-selected={browsing === group.id}
                  className={cn(browsing === group.id && "is-selected")} onClick={() => setBrowsing(group.id)}>
                  {group.id ? <FolderIcon className="size-3.5 shrink-0" /> : <InboxIcon className="size-3.5 shrink-0" />}
                  <b>{group.name}</b>
                  <em>{countIn(group.id)}</em>
                  {activeGroup === group.id && <span className="chat-group-here" title="当前聊天在这里" />}
                  <ChevronRightIcon className="chat-group-arrow size-3 shrink-0" />
                </button>
              ))}
              {creating ? (
                <form className="chat-group-new" onSubmit={(event) => { event.preventDefault(); createGroup(); }}>
                  <input autoFocus maxLength={30} value={name} placeholder="文件夹名称" aria-label="新文件夹名称"
                    onChange={(event) => setName(event.target.value)} />
                  <button type="submit" disabled={!name.trim()}>创建</button>
                </form>
              ) : (
                <button type="button" className="chat-group-create" onClick={() => setCreating(true)}
                  disabled={data.groups.length >= MAX_THREAD_GROUPS}>
                  <FolderPlusIcon className="size-3.5" /> 新建文件夹
                </button>
              )}
            </div>
            <div className="chat-group-chats" aria-label={`${browsingName} 里的聊天`}>
              <small>{browsingName} 里的聊天</small>
              <div className="chat-group-pane" key={browsing || "ungrouped"}>
                {freshHere ? (
                  <button type="button" className="chat-group-new-chat is-current" title="还没发消息的新聊天只会有一个"
                    onClick={() => {
                      close();
                      document.querySelector<HTMLTextAreaElement>(".aui-composer-input")?.focus();
                    }}>
                    <MessageSquarePlusIcon className="size-3.5" /> 当前就是新聊天
                    <span>直接输入</span>
                  </button>
                ) : (
                  <button type="button" className="chat-group-new-chat"
                    onClick={() => { close(); startChatInGroup(aui, browsing || undefined, true); }}>
                    <MessageSquarePlusIcon className="size-3.5" /> 在这里新建聊天
                  </button>
                )}
                <div className="chat-group-chat-list" role="listbox">
                  {members.length ? members.map((id) => (
                    <button type="button" key={id} role="option" aria-selected={id === mainThreadId} title={titleOf(id)}
                      className={cn(id === mainThreadId && "is-selected")}
                      onClick={() => { close(); if (id !== mainThreadId) openChat(aui, id); }}>
                      <span>{titleOf(id)}</span>
                      {id === mainThreadId && <CheckIcon className="size-3.5 shrink-0" />}
                    </button>
                  )) : <p>这个文件夹里还没有聊天</p>}
                </div>
                {mainThreadId && activeGroup !== browsing && (
                  <button type="button" className="chat-group-move" onClick={moveCurrent}
                    title={`把「${titleOf(mainThreadId)}」移到「${browsingName}」`}>
                    <CornerDownRightIcon className="size-3.5" /> 把当前聊天移到这里
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
