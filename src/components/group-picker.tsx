"use client";

import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, ChevronRight, CornerDownRight, Folder, FolderOpen, FolderPlus, Inbox, MessageSquarePlus } from "lucide-react";
import type { ConversationGroup } from "@/components/conversation-list";
import type { Conversation } from "@/lib/types";

const CLOSE_MS = 150;
/** 「未分组」在列表里的 ID */
const UNGROUPED = "";

/**
 * 输入框里的「项目分组」:先选文件夹,再选里面的对话(或在这个文件夹里新建一个),
 * 接下来发送的生成就进这条对话。和侧边栏的分组是同一套;输入框里写了一半的提示词会保留。
 */
export function GroupPicker({ groups, conversations, activeId, onOpen, onCreateIn, onMoveCurrent, onCreateGroup }: {
  groups: ConversationGroup[];
  conversations: Conversation[];
  activeId?: string;
  /** 切到某个已有对话 */
  onOpen: (conversationId: string) => void;
  /** 在这个分组(undefined 为未分组)里新建对话并切过去 */
  onCreateIn: (groupId: string | undefined) => void;
  /** 把当前对话移到这个分组 */
  onMoveCurrent: (groupId: string | undefined) => void;
  onCreateGroup: (name: string) => ConversationGroup;
}) {
  const [open, setOpen] = useState(false);
  const [closing, setClosing] = useState(false);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const groupIds = new Set(groups.map((group) => group.id));
  const groupOf = (conversation?: Conversation) =>
    conversation?.groupId && groupIds.has(conversation.groupId) ? conversation.groupId : UNGROUPED;
  const active = conversations.find((item) => item.id === activeId);
  const activeGroup = groupOf(active);
  const [browsing, setBrowsing] = useState(activeGroup);
  const current = groups.find((group) => group.id === activeGroup);
  const members = conversations
    .filter((item) => groupOf(item) === browsing)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const browsingName = browsing ? groups.find((group) => group.id === browsing)?.name || "" : "未分组";
  const countIn = (groupId: string) => conversations.filter((item) => groupOf(item) === groupId).length;

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

  const submitNew = () => {
    const trimmed = name.trim().slice(0, 30);
    if (!trimmed) return;
    const group = onCreateGroup(trimmed);
    setCreating(false);
    setName("");
    setBrowsing(group.id);
  };

  return <div className="parameter-control group-picker" ref={rootRef}>
    <button type="button" className={`parameter-trigger group-trigger ${open ? "active" : ""} ${current ? "has-group" : ""}`}
      aria-expanded={open} aria-haspopup="dialog"
      title={`${current ? current.name : "未分组"} / ${active?.title || "新对话"}：选择这次生成放进哪个文件夹的哪条对话`}
      onClick={toggle}>
      {current ? <FolderOpen size={13} /> : <Folder size={13} />}
      <span>{current?.name || "未分组"}</span>
      <i />
      <span className="group-trigger-chat">{active?.title || "新对话"}</span>
      <ChevronDown size={13} />
    </button>
    {open && <div className={`mode-popover group-popover ${closing ? "is-closing" : ""}`} role="dialog" aria-label="选择文件夹和对话">
      <div className="group-popover-cols">
        <div className="group-popover-folders" role="listbox" aria-label="文件夹">
          <small>文件夹</small>
          {[{ id: UNGROUPED, name: "未分组" }, ...groups].map((group) => (
            <button type="button" key={group.id || "ungrouped"} role="option" aria-selected={browsing === group.id}
              className={browsing === group.id ? "selected" : ""} onClick={() => setBrowsing(group.id)}>
              {group.id ? <Folder size={13} /> : <Inbox size={13} />}
              <b>{group.name}</b>
              <em>{countIn(group.id)}</em>
              {activeGroup === group.id && <span className="group-popover-here" title="当前对话在这里" />}
              <ChevronRight size={12} />
            </button>
          ))}
          {creating
            ? <form className="group-popover-new" onSubmit={(event) => { event.preventDefault(); submitNew(); }}>
              <input autoFocus maxLength={30} value={name} placeholder="文件夹名称" aria-label="新文件夹名称"
                onChange={(event) => setName(event.target.value)} />
              <button type="submit" disabled={!name.trim()}>创建</button>
            </form>
            : <button type="button" className="group-popover-create" onClick={() => setCreating(true)}>
              <FolderPlus size={13} /> 新建文件夹
            </button>}
        </div>
        <div className="group-popover-chats" role="listbox" aria-label={`${browsingName} 里的对话`}>
          <small>{browsingName} 里的对话</small>
          <button type="button" className="group-popover-new-chat" onClick={() => { close(); onCreateIn(browsing || undefined); }}>
            <MessageSquarePlus size={14} /> 在这里新建对话
          </button>
          <div className="group-popover-chat-list">
            {members.length ? members.map((item) => (
              <button type="button" key={item.id} role="option" aria-selected={item.id === activeId}
                className={item.id === activeId ? "selected" : ""}
                onClick={() => { close(); if (item.id !== activeId) onOpen(item.id); }} title={item.title}>
                <span>{item.title || "新对话"}</span>
                {item.id === activeId && <Check size={13} />}
              </button>
            )) : <p>这个文件夹里还没有对话</p>}
          </div>
          {active && activeGroup !== browsing && (
            <button type="button" className="group-popover-move" onClick={() => { close(); onMoveCurrent(browsing || undefined); }}
              title={`把「${active.title || "新对话"}」移到「${browsingName}」`}>
              <CornerDownRight size={13} /> 把当前对话移到这里
            </button>
          )}
        </div>
      </div>
    </div>}
  </div>;
}
