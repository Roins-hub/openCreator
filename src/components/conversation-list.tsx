"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Check, ChevronDown, ChevronRight, Folder, FolderPlus, ListChecks, MoreHorizontal, Pencil, Trash2, X,
} from "lucide-react";
import { Dropdown } from "@/components/dropdown";
import { HistoryMenu } from "@/components/history-menu";
import type { Conversation } from "@/lib/types";

export interface ConversationGroup {
  id: string;
  name: string;
  collapsed?: boolean;
}

const DRAG_TYPE = "application/x-mote-conversation";

/**
 * 侧边栏对话列表:分组(可折叠、重命名、解散,拖动对话放进分组)和「管理」模式
 * (多选 / 全选后一键删除或移动)。数据的读写由外层负责。
 */
export function ConversationList({
  conversations, groups, activeId, onOpen, onRename, onDelete, onMove, onGroupsChange, onCreateGroup,
}: {
  conversations: Conversation[];
  groups: ConversationGroup[];
  activeId?: string;
  onOpen: (id: string) => void;
  onRename: (conversation: Conversation, title: string) => void;
  onDelete: (ids: string[]) => Promise<void>;
  onMove: (ids: string[], groupId: string | undefined) => Promise<void>;
  onGroupsChange: (groups: ConversationGroup[]) => void;
  onCreateGroup: (name: string) => ConversationGroup;
}) {
  const [managing, setManaging] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(() => new Set());
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [renamingGroup, setRenamingGroup] = useState<string>();
  const [groupMenu, setGroupMenu] = useState<string>();
  const [dropTarget, setDropTarget] = useState<string>();
  const [busy, setBusy] = useState(false);

  const groupIds = useMemo(() => new Set(groups.map((group) => group.id)), [groups]);
  const inGroup = (conversation: Conversation) =>
    conversation.groupId && groupIds.has(conversation.groupId) ? conversation.groupId : undefined;
  const ungrouped = conversations.filter((conversation) => !inGroup(conversation));

  // 只算仍然存在的对话(删除后选中项自动失效)
  const selected = useMemo(() => {
    const ids = new Set(conversations.map((item) => item.id));
    return new Set([...picked].filter((id) => ids.has(id)));
  }, [picked, conversations]);

  useEffect(() => {
    if (!groupMenu) return;
    const close = (event: MouseEvent) => {
      if (!(event.target as HTMLElement).closest?.(".group-menu")) setGroupMenu(undefined);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [groupMenu]);

  const allSelected = conversations.length > 0 && conversations.every((item) => selected.has(item.id));

  const toggle = (ids: string[], on: boolean) => setPicked(() => {
    const next = new Set(selected);
    for (const id of ids) {
      if (on) next.add(id);
      else next.delete(id);
    }
    return next;
  });

  const stopManaging = () => {
    setManaging(false);
    setPicked(new Set());
    setConfirmDelete(false);
  };

  const createGroup = () => {
    const name = newName.trim();
    if (!name) return;
    onCreateGroup(name);
    setNewName("");
    setCreating(false);
  };

  const run = async (task: () => Promise<void>) => {
    setBusy(true);
    try { await task(); } finally { setBusy(false); }
  };

  const updateGroup = (id: string, patch: Partial<ConversationGroup>) =>
    onGroupsChange(groups.map((group) => group.id === id ? { ...group, ...patch } : group));

  const dissolveGroup = (id: string) => {
    setGroupMenu(undefined);
    const members = conversations.filter((item) => item.groupId === id).map((item) => item.id);
    onGroupsChange(groups.filter((group) => group.id !== id));
    if (members.length) void onMove(members, undefined);
  };

  const dropProps = (groupId: string | undefined) => managing ? {} : {
    onDragOver: (event: React.DragEvent) => {
      if (!event.dataTransfer.types.includes(DRAG_TYPE)) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
      setDropTarget(groupId ?? "");
    },
    onDragLeave: (event: React.DragEvent) => {
      if (!(event.currentTarget as HTMLElement).contains(event.relatedTarget as Node)) setDropTarget(undefined);
    },
    onDrop: (event: React.DragEvent) => {
      const id = event.dataTransfer.getData(DRAG_TYPE);
      setDropTarget(undefined);
      if (!id) return;
      event.preventDefault();
      const conversation = conversations.find((item) => item.id === id);
      if (conversation && inGroup(conversation) !== groupId) void onMove([id], groupId);
    },
  };

  const row = (conversation: Conversation) => {
    const checked = selected.has(conversation.id);
    return <div key={conversation.id}
      className={`history-row ${conversation.id === activeId && !managing ? "active" : ""} ${managing && checked ? "selected" : ""}`}
      draggable={!managing}
      onDragStart={(event) => {
        event.dataTransfer.setData(DRAG_TYPE, conversation.id);
        event.dataTransfer.effectAllowed = "move";
      }}>
      {managing ? <label className="history-title history-check">
        <input type="checkbox" checked={checked} onChange={(event) => toggle([conversation.id], event.target.checked)} />
        <span>{conversation.title}</span>
      </label> : <>
        <button className="history-title" onClick={() => onOpen(conversation.id)}>{conversation.title}</button>
        <HistoryMenu title={conversation.title}
          onRename={(title) => onRename(conversation, title)}
          onDelete={() => void onDelete([conversation.id])}
          groups={groups} groupId={inGroup(conversation)}
          onMove={(groupId) => void onMove([conversation.id], groupId)} />
      </>}
    </div>;
  };

  return <div className="conversation-list">
    <div className="history-label history-toolbar">
      <span>对话</span>
      {!managing && <span className="history-tools">
        <button type="button" onClick={() => { setCreating(true); setNewName(""); }} title="新建分组" aria-label="新建分组">
          <FolderPlus size={14} />
        </button>
        <button type="button" onClick={() => setManaging(true)} disabled={!conversations.length}
          title="管理对话（多选删除、移动）" aria-label="管理对话"><ListChecks size={14} /></button>
      </span>}
    </div>

    {managing && <div className="manage-bar">
      <label>
        <input type="checkbox" checked={allSelected}
          onChange={(event) => setPicked(event.target.checked ? new Set(conversations.map((item) => item.id)) : new Set())} />
        全选
      </label>
      <span>已选 {selected.size}</span>
      <button type="button" onClick={stopManaging} aria-label="退出管理">完成</button>
    </div>}

    <nav className="history">
      {creating && <div className="group-create">
        <Folder size={14} />
        <input autoFocus maxLength={30} value={newName} placeholder="分组名称，回车创建"
          onChange={(event) => setNewName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") createGroup();
            if (event.key === "Escape") setCreating(false);
          }}
          onBlur={() => { if (!newName.trim()) setCreating(false); }} />
        <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={createGroup}
          disabled={!newName.trim()} aria-label="创建分组"><Check size={14} /></button>
      </div>}

      {groups.map((group) => {
        const members = conversations.filter((item) => item.groupId === group.id);
        const memberIds = members.map((item) => item.id);
        const groupChecked = members.length > 0 && memberIds.every((id) => selected.has(id));
        return <section key={group.id} className={`history-group ${dropTarget === group.id ? "drop-target" : ""}`}
          {...dropProps(group.id)}>
          <div className="group-head">
            {managing && <input type="checkbox" aria-label={`选择分组${group.name}的全部对话`}
              checked={groupChecked} disabled={!members.length}
              onChange={(event) => toggle(memberIds, event.target.checked)} />}
            {renamingGroup === group.id ? <input className="group-rename" autoFocus maxLength={30} defaultValue={group.name}
              aria-label="分组名称"
              onKeyDown={(event) => {
                const value = event.currentTarget.value.trim();
                if (event.key === "Enter" && value) { updateGroup(group.id, { name: value }); setRenamingGroup(undefined); }
                if (event.key === "Escape") setRenamingGroup(undefined);
              }}
              onBlur={(event) => {
                const value = event.currentTarget.value.trim();
                if (value && value !== group.name) updateGroup(group.id, { name: value });
                setRenamingGroup(undefined);
              }} /> : <button type="button" className="group-toggle" aria-expanded={!group.collapsed}
                onClick={() => updateGroup(group.id, { collapsed: !group.collapsed })}>
              {group.collapsed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
              <Folder size={13} />
              <span>{group.name}</span>
              <em>{members.length}</em>
            </button>}
            {!managing && renamingGroup !== group.id && <div className="group-menu">
              <button type="button" className="history-more" aria-label={`${group.name}分组的更多操作`}
                aria-expanded={groupMenu === group.id}
                onClick={() => setGroupMenu((current) => current === group.id ? undefined : group.id)}>
                <MoreHorizontal size={15} />
              </button>
              {groupMenu === group.id && <div className="history-popover">
                <button type="button" className="history-action"
                  onClick={() => { setGroupMenu(undefined); setRenamingGroup(group.id); }}>
                  <Pencil size={14} /> 重命名分组
                </button>
                <button type="button" className="history-action history-delete" onClick={() => dissolveGroup(group.id)}
                  title="对话不会被删除，会回到「未分组」">
                  <X size={14} /> 解散分组
                </button>
              </div>}
            </div>}
          </div>
          {!group.collapsed && (members.length
            ? <div className="group-items">{members.map(row)}</div>
            : <p className="group-empty">{managing ? "空分组" : "把对话拖到这里，或在对话的「…」里选择移到分组"}</p>)}
        </section>;
      })}

      <section className={`history-ungrouped ${dropTarget === "" ? "drop-target" : ""}`} {...dropProps(undefined)}>
        {groups.length > 0 && <div className="history-sublabel">未分组</div>}
        {ungrouped.map(row)}
      </section>
    </nav>

    {managing && <div className="manage-actions">
      {confirmDelete ? <>
        <span>删除 {selected.size} 个对话？无法撤销</span>
        <button type="button" onClick={() => setConfirmDelete(false)}>取消</button>
        <button type="button" className="danger" disabled={busy}
          onClick={() => void run(async () => { await onDelete([...selected]); setConfirmDelete(false); setPicked(new Set()); })}>
          确认删除
        </button>
      </> : <>
        <Dropdown className="manage-move" ariaLabel="移到分组" placeholder="移到分组…" value=""
          disabled={!selected.size || busy}
          options={[
            ...groups.map((group) => ({ value: group.id, label: group.name })),
            { value: "__none", label: "移出分组" },
          ]}
          onChange={(value) => void run(() => onMove([...selected], value === "__none" ? undefined : value))} />
        <button type="button" className="danger" disabled={!selected.size || busy} onClick={() => setConfirmDelete(true)}>
          <Trash2 size={13} /> 删除{selected.size ? ` ${selected.size} 个` : ""}
        </button>
      </>}
    </div>}
  </div>;
}
