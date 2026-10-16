"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  DndContext, DragOverlay, MouseSensor, TouchSensor, useDraggable, useDroppable, useSensor, useSensors,
  type CollisionDetection, type DragEndEvent, type DragOverEvent,
} from "@dnd-kit/core";
import { droppablesUnderPointer, startDragPointer, stopDragPointer } from "@/lib/drag-pointer";
import {
  Check, ChevronDown, ChevronRight, Folder, FolderPlus, ListChecks, MoreHorizontal, Pencil, Search, Trash2, X,
} from "lucide-react";
import { Dropdown } from "@/components/dropdown";
import { HistoryMenu } from "@/components/history-menu";
import { matchConversation } from "@/lib/conversation-search";
import type { Conversation } from "@/lib/types";

export interface ConversationGroup {
  id: string;
  name: string;
  collapsed?: boolean;
}

/** 放置区的 ID:分组用「group:分组ID」,未分组用「group:」 */
const DROP = "group:";
/** 鼠标在哪个分组区域里就放到哪个分组 */
const collision: CollisionDetection = (args) => droppablesUnderPointer(args, DROP).slice(0, 1).map((item) => ({ id: item.id }));

/** 侧边栏的一行对话,按住拖动(原位置留下虚影,拿起的那一行浮在鼠标下) */
function DraggableRow({ id, disabled, className, children }: {
  id: string; disabled: boolean; className: string; children: ReactNode;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id, disabled });
  return (
    <div ref={setNodeRef} {...attributes} {...listeners} tabIndex={-1} role={undefined}
      aria-roledescription="可拖动的对话" className={`${className} ${isDragging ? "is-placeholder" : ""}`}>
      {children}
    </div>
  );
}

function DropSection({ groupId, disabled, className, children }: {
  groupId: string | undefined; disabled: boolean; className: string; children: ReactNode;
}) {
  const { setNodeRef } = useDroppable({ id: DROP + (groupId ?? ""), disabled });
  return <section ref={setNodeRef} className={className}>{children}</section>;
}

/**
 * 侧边栏对话列表:搜索过滤、分组(可折叠、重命名、解散,拖动对话放进分组)和「管理」模式
 * (多选 / 全选后一键删除或移动)。数据的读写由外层负责。
 */
export function ConversationList({
  conversations: allConversations, groups, activeId, onOpen, onRename, onDelete, onMove, onGroupsChange, onCreateGroup,
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
  const [draggingId, setDraggingId] = useState<string>();
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 220, tolerance: 6 } }),
  );
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState("");

  // 搜索时只显示匹配的对话;全选、批量删除和移动也只作用于这些对话
  const searching = query.trim().length > 0;
  const conversations = useMemo(
    () => allConversations.filter((conversation) => matchConversation(conversation, query)),
    [allConversations, query],
  );

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

  // 拖到别的分组(或「未分组」)上松手就移过去;拖回原分组不做任何事
  const dragOver = ({ active, over }: DragOverEvent) => {
    const target = over ? String(over.id).slice(DROP.length) : undefined;
    const conversation = conversations.find((item) => item.id === active.id);
    setDropTarget(conversation && target !== undefined && (inGroup(conversation) ?? "") !== target ? target : undefined);
  };
  const dragEnd = ({ active, over }: DragEndEvent) => {
    stopDragPointer();
    setDraggingId(undefined);
    setDropTarget(undefined);
    if (!over) return;
    const target = String(over.id).slice(DROP.length) || undefined;
    const conversation = conversations.find((item) => item.id === active.id);
    if (conversation && inGroup(conversation) !== target) void onMove([conversation.id], target);
  };
  const dragging = draggingId ? conversations.find((item) => item.id === draggingId) : undefined;

  const row = (conversation: Conversation) => {
    const checked = selected.has(conversation.id);
    return <DraggableRow key={conversation.id} id={conversation.id} disabled={managing}
      className={`history-row ${conversation.id === activeId && !managing ? "active" : ""} ${managing && checked ? "selected" : ""}`}>
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
    </DraggableRow>;
  };

  return <div className="conversation-list">
    <div className="history-label history-toolbar">
      <span>对话</span>
      {!managing && <span className="history-tools">
        <button type="button" onClick={() => { setCreating(true); setNewName(""); }} title="新建分组" aria-label="新建分组">
          <FolderPlus size={14} />
        </button>
        <button type="button" onClick={() => setManaging(true)} disabled={!allConversations.length}
          title="管理对话（多选删除、移动）" aria-label="管理对话"><ListChecks size={14} /></button>
      </span>}
    </div>

    {allConversations.length > 0 && <div className="history-search">
      <Search size={13} />
      <input type="search" value={query} placeholder="搜索标题或内容" aria-label="搜索侧栏对话"
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={(event) => { if (event.key === "Escape") setQuery(""); }} />
      {searching && <button type="button" onClick={() => setQuery("")} aria-label="清空搜索"><X size={13} /></button>}
    </div>}

    {managing && <div className="manage-bar">
      <label>
        <input type="checkbox" checked={allSelected}
          onChange={(event) => setPicked(event.target.checked ? new Set(conversations.map((item) => item.id)) : new Set())} />
        全选
      </label>
      <span>已选 {selected.size}</span>
      <button type="button" onClick={stopManaging} aria-label="退出管理">完成</button>
    </div>}

    <DndContext sensors={sensors} collisionDetection={collision}
      onDragStart={(event) => { startDragPointer(event); setDraggingId(String(event.active.id)); }}
      onDragOver={dragOver} onDragEnd={dragEnd}
      onDragCancel={() => { stopDragPointer(); setDraggingId(undefined); setDropTarget(undefined); }}>
    <nav className={`history ${draggingId ? "is-dragging" : ""}`}>
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
        // 搜索时隐藏没有匹配项的分组,有匹配的分组自动展开
        if (searching && !members.length) return null;
        const collapsed = !searching && group.collapsed;
        const memberIds = members.map((item) => item.id);
        const groupChecked = members.length > 0 && memberIds.every((id) => selected.has(id));
        return <DropSection key={group.id} groupId={group.id} disabled={managing}
          className={`history-group ${dropTarget === group.id ? "drop-target" : ""}`}>
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
              }} /> : <button type="button" className="group-toggle" aria-expanded={!collapsed}
                disabled={searching} onClick={() => updateGroup(group.id, { collapsed: !group.collapsed })}>
              {collapsed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
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
          {!collapsed && (members.length
            ? <div className="group-items">{members.map(row)}</div>
            : <p className="group-empty">{managing ? "空分组" : "把对话拖到这里，或在对话的「…」里选择移到分组"}</p>)}
        </DropSection>;
      })}

      <DropSection groupId={undefined} disabled={managing}
        className={`history-ungrouped ${dropTarget === "" ? "drop-target" : ""}`}>
        {groups.length > 0 && (!searching || ungrouped.length > 0) && <div className="history-sublabel">未分组</div>}
        {ungrouped.map(row)}
      </DropSection>
      {searching && !conversations.length && <p className="history-empty">没有找到「{query.trim()}」相关的对话</p>}
    </nav>
    {typeof document !== "undefined" && createPortal(
      <DragOverlay className="mote-drag-overlay">
        {dragging && <div className="history-row is-lifted"><span className="history-title">{dragging.title}</span></div>}
      </DragOverlay>,
      document.body,
    )}
    </DndContext>

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
