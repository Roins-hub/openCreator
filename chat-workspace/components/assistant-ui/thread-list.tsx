"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import {
  AuiIf,
  ThreadListItemMorePrimitive,
  ThreadListItemPrimitive,
  ThreadListPrimitive,
  useAui,
  useAuiState,
} from "@assistant-ui/react";
import {
  ArchiveIcon,
  CheckIcon,
  ChevronDownIcon,
  FolderIcon,
  FolderPlusIcon,
  ListChecksIcon,
  Loader2Icon,
  MoreHorizontalIcon,
  PencilIcon,
  PlusIcon,
  SearchIcon,
  TrashIcon,
  XIcon,
} from "lucide-react";
import {
  createContext,
  forwardRef,
  Fragment,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentPropsWithoutRef,
  type FC,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import {
  DndContext,
  DragOverlay,
  MouseSensor,
  TouchSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragOverEvent,
} from "@dnd-kit/core";
import { droppablesUnderPointer, startDragPointer, stopDragPointer } from "@/lib/drag-pointer";
import {
  dissolveGroup,
  emptyThreadGroups,
  loadThreadGroups,
  MAX_THREAD_GROUPS,
  moveThreads,
  newGroupId,
  saveThreadGroups,
  type ThreadGroup,
  type ThreadGroups,
} from "@/lib/thread-groups";

export const ThreadList: FC = () => {
  const [search, setSearch] = useState("");
  const hasThreads = useAuiState((s) => s.threads.threadIds.length > 0);

  return (
    <ThreadListRoot>
      <ThreadListNew />
      {hasThreads && <ThreadListSearch value={search} onValueChange={setSearch} />}
      <ThreadListItems searchQuery={hasThreads ? search : ""} />
    </ThreadListRoot>
  );
};

export const ThreadListSearch = forwardRef<
  HTMLInputElement,
  Omit<ComponentPropsWithoutRef<typeof Input>, "value" | "onChange"> & {
    value: string;
    onValueChange: (value: string) => void;
  }
>(({ className, value, onValueChange, ...props }, ref) => (
  <div data-slot="aui_thread-list-search" className="relative px-0.5 py-1">
    <SearchIcon className="text-muted-foreground pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2" />
    <Input
      ref={ref}
      type="search"
      value={value}
      onChange={(event) => onValueChange(event.target.value)}
      aria-label="搜索聊天"
      placeholder="搜索聊天"
      className={cn("h-8 ps-8 text-sm", className)}
      {...props}
    />
  </div>
));

ThreadListSearch.displayName = "ThreadListSearch";

export const ThreadListRoot: FC<ComponentPropsWithoutRef<typeof ThreadListPrimitive.Root>> = ({
  className,
  ...props
}) => (
  <ThreadListPrimitive.Root
    data-slot="aui_thread-list-root"
    className={cn("flex flex-col gap-0.5", className)}
    {...props}
  />
);

/** searchQuery 不传时列表自带搜索框 */
export const ThreadListItems: FC<ComponentPropsWithoutRef<"div"> & { searchQuery?: string }> = ({
  className,
  searchQuery,
  ...props
}) => (
  <div
    data-slot="aui_thread-list-items"
    className={cn("ws-list flex flex-col", className)}
    {...props}
  >
    <AuiIf condition={(s) => s.threads.isLoading}>
      <ThreadListSkeleton />
    </AuiIf>
    <AuiIf condition={(s) => !s.threads.isLoading}>
      <ThreadListOrganizer searchQuery={searchQuery} />
    </AuiIf>
  </div>
);

const DAY_IN_MS = 86_400_000;

const dateGroupLabel = (date: Date | undefined, startOfToday: number): string => {
  if (!date || date.getTime() >= startOfToday) return "今天";
  if (date.getTime() >= startOfToday - DAY_IN_MS) return "昨天";
  return "更早";
};

/** 管理模式的状态,给每一行聊天读取 */
type OrganizerContextValue = {
  managing: boolean;
  selected: ReadonlySet<string>;
  toggle: (id: string) => void;
};
const OrganizerContext = createContext<OrganizerContextValue>({
  managing: false,
  selected: new Set(),
  toggle: () => undefined,
});

/** 放置区 ID:分组用「group:分组ID」,未分组用「group:」 */
const DROP = "group:";
/** 鼠标在哪个分组区域里就放到哪个分组(按鼠标的真实位置判断,列表滚动也不会偏) */
const dropCollision: CollisionDetection = (args) =>
  droppablesUnderPointer(args, DROP).slice(0, 1).map((item) => ({ id: item.id }));


/**
 * 侧栏的聊天列表:搜索、分组(可折叠、重命名、解散,拖动聊天放进分组)、
 * 「管理」模式(多选 / 全选后批量删除或移动)。不在分组里的聊天仍按 今天 / 昨天 / 更早 排。
 */
const ThreadListOrganizer: FC<{ searchQuery?: string }> = ({ searchQuery }) => {
  const aui = useAui();
  const threadIds = useAuiState((s) => s.threads.threadIds);
  const threadItems = useAuiState((s) => s.threads.threadItems);
  const [ownQuery, setOwnQuery] = useState("");
  const query = (searchQuery ?? ownQuery).trim().toLowerCase();
  const searching = query.length > 0;
  const [data, setData] = useState<ThreadGroups>(emptyThreadGroups);
  const [managing, setManaging] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(() => new Set());
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [renaming, setRenaming] = useState<string>();
  const [groupMenu, setGroupMenu] = useState<string>();
  const [moveOpen, setMoveOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const [draggingId, setDraggingId] = useState<string>();
  const [dropTarget, setDropTarget] = useState<string>();
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 220, tolerance: 6 } }),
  );

  useEffect(() => {
    let alive = true;
    loadThreadGroups()
      .then((value) => {
        if (alive) setData(value);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!groupMenu && !moveOpen) return;
    const close = (event: globalThis.MouseEvent) => {
      if (!(event.target as HTMLElement).closest?.("[data-organizer-menu]")) {
        setGroupMenu(undefined);
        setMoveOpen(false);
      }
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [groupMenu, moveOpen]);

  const update = (next: ThreadGroups) => {
    setData(next);
    void saveThreadGroups(next).catch(() => undefined);
  };

  const itemsById = useMemo(() => new Map(threadItems.map((item) => [item.id, item])), [threadItems]);
  const titleOf = (id: string) => itemsById.get(id)?.title || "新聊天";
  const visible = useMemo(
    () =>
      threadIds
        .map((id, index) => ({ id, index }))
        .filter(({ id }) => !query || (itemsById.get(id)?.title || "新聊天").toLowerCase().includes(query)),
    [threadIds, itemsById, query],
  );
  const groupIds = new Set(data.groups.map((group) => group.id));
  const groupOf = (id: string) => (data.assign[id] && groupIds.has(data.assign[id]) ? data.assign[id] : undefined);
  const ungrouped = visible.filter(({ id }) => !groupOf(id));
  // 只算仍然可见的聊天(删除或搜索后,选中项自动失效)
  const selected = useMemo(() => {
    const ids = new Set(visible.map((item) => item.id));
    return new Set([...picked].filter((id) => ids.has(id)));
  }, [picked, visible]);
  const allSelected = visible.length > 0 && visible.every((item) => selected.has(item.id));

  const toggle = (id: string) =>
    setPicked(() => {
      const next = new Set(selected);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const stopManaging = () => {
    setManaging(false);
    setPicked(new Set());
    setConfirmDelete(false);
    setMoveOpen(false);
  };

  const createGroup = () => {
    const name = newName.trim().slice(0, 30);
    setCreating(false);
    setNewName("");
    if (!name || data.groups.length >= MAX_THREAD_GROUPS) return;
    update({ ...data, groups: [...data.groups, { id: newGroupId(), name }] });
  };
  const patchGroup = (id: string, patch: Partial<ThreadGroup>) =>
    update({ ...data, groups: data.groups.map((group) => (group.id === id ? { ...group, ...patch } : group)) });
  const moveSelected = (groupId: string | undefined) => {
    update(moveThreads(data, [...selected], groupId));
    setMoveOpen(false);
    setPicked(new Set());
  };

  const deleteSelected = async () => {
    setBusy(true);
    try {
      const ids = [...selected];
      for (const id of ids) {
        await Promise.resolve(aui.threads.item({ id }).delete());
      }
      update(moveThreads(data, ids, undefined));
      setPicked(new Set());
      setConfirmDelete(false);
    } finally {
      setBusy(false);
    }
  };

  // 拖到别的分组(或「未分组」)上松手就移过去;拖回原分组不做任何事
  const dragOver = ({ active, over }: DragOverEvent) => {
    const target = over ? String(over.id).slice(DROP.length) : undefined;
    setDropTarget(target !== undefined && (groupOf(String(active.id)) ?? "") !== target ? target : undefined);
  };
  const dragEnd = ({ active, over }: DragEndEvent) => {
    stopDragPointer();
    setDraggingId(undefined);
    setDropTarget(undefined);
    if (!over) return;
    const target = String(over.id).slice(DROP.length) || undefined;
    const id = String(active.id);
    if (groupOf(id) !== target) update(moveThreads(data, [id], target));
  };

  const renderItem = (index: number) => (
    <ThreadListPrimitive.ItemByIndex key={threadIds[index]} index={index} components={{ ThreadListItem }} />
  );

  // 不在分组里的聊天按日期分段(没有时间信息时不分段)
  const ungroupedSections = (() => {
    const dates = new Map(ungrouped.map(({ id }) => [id, itemsById.get(id)?.lastMessageAt]));
    if (!ungrouped.some(({ id }) => dates.get(id))) return [{ label: "", items: ungrouped }];
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const time = (id: string) => dates.get(id)?.getTime() ?? Number.MAX_SAFE_INTEGER;
    const sections: { label: string; items: typeof ungrouped }[] = [];
    for (const item of [...ungrouped].sort((a, b) => time(b.id) - time(a.id))) {
      const label = dateGroupLabel(dates.get(item.id), startOfToday);
      const last = sections[sections.length - 1];
      if (last?.label === label) last.items.push(item);
      else sections.push({ label, items: [item] });
    }
    return sections;
  })();

  const hasThreads = threadIds.length > 0;

  return (
    <OrganizerContext.Provider value={{ managing, selected, toggle }}>
      {hasThreads && (
        <div className="ws-label">
          <span>聊天</span>
          {!managing && (
            <span className="ws-tools">
              <button
                type="button"
                title="新建分组"
                aria-label="新建分组"
                onClick={() => {
                  setCreating(true);
                  setNewName("");
                }}
              >
                <FolderPlusIcon />
              </button>
              <button type="button" title="管理聊天（多选删除、移动）" aria-label="管理聊天" onClick={() => setManaging(true)}>
                <ListChecksIcon />
              </button>
            </span>
          )}
        </div>
      )}
      {hasThreads && searchQuery === undefined && (
        <div className="ws-search">
          <SearchIcon />
          <input
            type="search"
            value={ownQuery}
            placeholder="搜索聊天标题"
            aria-label="搜索聊天"
            onChange={(event) => setOwnQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") setOwnQuery("");
            }}
          />
          {ownQuery && (
            <button type="button" aria-label="清空搜索" onClick={() => setOwnQuery("")}>
              <XIcon className="size-3.5" />
            </button>
          )}
        </div>
      )}
      {managing && (
        <div className="ws-manage-bar">
          <label>
            <input
              type="checkbox"
              checked={allSelected}
              onChange={(event) =>
                setPicked(event.target.checked ? new Set(visible.map((item) => item.id)) : new Set())
              }
            />
            全选
          </label>
          <span>已选 {selected.size}</span>
          <button type="button" onClick={stopManaging}>
            完成
          </button>
        </div>
      )}
      {creating && (
        <div className="ws-create">
          <FolderIcon />
          <input
            autoFocus
            maxLength={30}
            value={newName}
            placeholder="分组名称，回车创建"
            className="ws-rename"
            onChange={(event) => setNewName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") createGroup();
              if (event.key === "Escape") {
                setCreating(false);
                setNewName("");
              }
            }}
            onBlur={() => {
              if (!newName.trim()) setCreating(false);
            }}
          />
          <button
            type="button"
            aria-label="创建分组"
            disabled={!newName.trim()}
            onMouseDown={(event) => event.preventDefault()}
            onClick={createGroup}
          >
            <CheckIcon className="size-4" />
          </button>
        </div>
      )}

      <DndContext
        sensors={sensors}
        collisionDetection={dropCollision}
        onDragStart={(event) => {
          startDragPointer(event);
          setDraggingId(String(event.active.id));
        }}
        onDragOver={dragOver}
        onDragEnd={dragEnd}
        onDragCancel={() => {
          stopDragPointer();
          setDraggingId(undefined);
          setDropTarget(undefined);
        }}
      >
        {data.groups.map((group) => {
          const members = visible.filter(({ id }) => groupOf(id) === group.id);
          // 搜索时隐藏没有匹配项的分组,有匹配的分组自动展开
          if (searching && !members.length) return null;
          const collapsed = !searching && Boolean(group.collapsed);
          const groupChecked = members.length > 0 && members.every(({ id }) => selected.has(id));
          return (
            <DropZone
              key={group.id}
              groupId={group.id}
              disabled={managing}
              className={cn("ws-group", dropTarget === group.id && "is-drop-target")}
            >
              <div className="ws-group-head">
                {managing && (
                  <input
                    type="checkbox"
                    aria-label={`选择分组${group.name}的全部聊天`}
                    checked={groupChecked}
                    disabled={!members.length}
                    onChange={(event) =>
                      setPicked(() => {
                        const next = new Set(selected);
                        for (const { id } of members) {
                          if (event.target.checked) next.add(id);
                          else next.delete(id);
                        }
                        return next;
                      })
                    }
                  />
                )}
                {renaming === group.id ? (
                  <input
                    autoFocus
                    maxLength={30}
                    defaultValue={group.name}
                    aria-label="分组名称"
                    className="ws-rename"
                    onKeyDown={(event) => {
                      const value = event.currentTarget.value.trim();
                      if (event.key === "Enter" && value) {
                        patchGroup(group.id, { name: value });
                        setRenaming(undefined);
                      }
                      if (event.key === "Escape") setRenaming(undefined);
                    }}
                    onBlur={(event) => {
                      const value = event.currentTarget.value.trim();
                      if (value && value !== group.name) patchGroup(group.id, { name: value });
                      setRenaming(undefined);
                    }}
                  />
                ) : (
                  <button
                    type="button"
                    className="ws-group-toggle"
                    aria-expanded={!collapsed}
                    disabled={searching}
                    onClick={() => patchGroup(group.id, { collapsed: !group.collapsed })}
                  >
                    <ChevronDownIcon className="ws-chevron" />
                    <FolderIcon />
                    <span>{group.name}</span>
                    <em>{members.length}</em>
                  </button>
                )}
                {!managing && renaming !== group.id && (
                  <div className="ws-group-menu" data-organizer-menu>
                    <button
                      type="button"
                      className="ws-more"
                      aria-label={`${group.name}分组的更多操作`}
                      aria-expanded={groupMenu === group.id}
                      onClick={() => setGroupMenu((current) => (current === group.id ? undefined : group.id))}
                    >
                      <MoreHorizontalIcon />
                    </button>
                    {groupMenu === group.id && (
                      <div className="ws-popover">
                        <button
                          type="button"
                          className="ws-action"
                          onClick={() => {
                            setGroupMenu(undefined);
                            setRenaming(group.id);
                          }}
                        >
                          <PencilIcon /> 重命名分组
                        </button>
                        <button
                          type="button"
                          title="聊天不会被删除，会回到「未分组」"
                          className="ws-action is-danger"
                          onClick={() => {
                            setGroupMenu(undefined);
                            update(dissolveGroup(data, group.id));
                          }}
                        >
                          <XIcon /> 解散分组
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
              {/* 内容一直在,收起时高度过渡到 0,展开收起都有动画;收起后里面的按钮不能被 Tab 到 */}
              <div className={cn("ws-group-body", collapsed && "is-collapsed")} inert={collapsed}>
                <div>
                  {members.length ? (
                    <div className="ws-group-items">{members.map(({ index }) => renderItem(index))}</div>
                  ) : (
                    <p className="ws-group-empty">{managing ? "空分组" : "把聊天拖到这里，或用「管理」移到分组"}</p>
                  )}
                </div>
              </div>
            </DropZone>
          );
        })}

        <DropZone
          groupId={undefined}
          disabled={managing}
          className={cn("ws-ungrouped", dropTarget === "" && "is-drop-target")}
        >
          {data.groups.length > 0 && ungrouped.length > 0 && <div className="ws-sublabel">未分组</div>}
          {ungroupedSections.map((section) => (
            <Fragment key={section.label || "all"}>
              {section.label && data.groups.length === 0 && <div className="ws-sublabel">{section.label}</div>}
              {section.items.map(({ index }) => renderItem(index))}
            </Fragment>
          ))}
        </DropZone>
        {searching && visible.length === 0 && <p className="ws-empty">没有找到「{query}」相关的聊天</p>}

        {typeof document !== "undefined" &&
          createPortal(
            <DragOverlay className="z-50">
              {draggingId && (
                <div className="ws-row-lifted">
                  <span>{titleOf(draggingId)}</span>
                </div>
              )}
            </DragOverlay>,
            document.body,
          )}
      </DndContext>

      {managing && (
        <div className="ws-manage-actions">
          {confirmDelete ? (
            <>
              <span>删除 {selected.size} 个聊天？无法撤销</span>
              <button type="button" onClick={() => setConfirmDelete(false)}>
                取消
              </button>
              <button type="button" className="is-danger" disabled={busy} onClick={() => void deleteSelected()}>
                {busy ? "删除中…" : "确认删除"}
              </button>
            </>
          ) : (
            <>
              <div className="ws-manage-move" data-organizer-menu>
                <button
                  type="button"
                  disabled={!selected.size || busy}
                  aria-expanded={moveOpen}
                  onClick={() => setMoveOpen((open) => !open)}
                >
                  移到分组…
                  <ChevronDownIcon />
                </button>
                {moveOpen && (
                  <div className="ws-popover opens-up">
                    {data.groups.map((group) => (
                      <button type="button" key={group.id} className="ws-action" onClick={() => moveSelected(group.id)}>
                        <FolderIcon /> <span>{group.name}</span>
                      </button>
                    ))}
                    {data.groups.length === 0 && <p className="ws-hint">还没有分组，先在上方新建一个</p>}
                    <button type="button" className="ws-action" onClick={() => moveSelected(undefined)}>
                      <XIcon /> <span>移出分组</span>
                    </button>
                  </div>
                )}
              </div>
              <button
                type="button"
                className="is-danger"
                disabled={!selected.size || busy}
                onClick={() => setConfirmDelete(true)}
              >
                <TrashIcon /> 删除{selected.size ? ` ${selected.size} 个` : ""}
              </button>
            </>
          )}
        </div>
      )}
    </OrganizerContext.Provider>
  );
};

function DropZone({
  groupId,
  disabled,
  className,
  children,
}: {
  groupId: string | undefined;
  disabled: boolean;
  className?: string;
  children: ReactNode;
}) {
  const { setNodeRef } = useDroppable({ id: DROP + (groupId ?? ""), disabled });
  return (
    <section ref={setNodeRef} className={className}>
      {children}
    </section>
  );
}

export const ThreadListNew = forwardRef<
  HTMLButtonElement,
  ComponentPropsWithoutRef<typeof Button> & { labelClassName?: string }
>(({ className, labelClassName, children, ...props }, ref) => (
  <ThreadListPrimitive.New asChild>
    <Button
      ref={ref}
      variant="ghost"
      data-slot="aui_thread-list-new"
      className={cn(
        "hover:bg-muted data-active:bg-muted h-8 justify-start gap-2 rounded-md px-2.5 text-sm font-normal",
        className,
      )}
      {...props}
    >
      {children ?? (
        <>
          <PlusIcon className="size-4 shrink-0" />
          <span className={cn("whitespace-nowrap", labelClassName)}>新聊天</span>
        </>
      )}
    </Button>
  </ThreadListPrimitive.New>
));

ThreadListNew.displayName = "ThreadListNew";

const ThreadListSkeleton: FC = () => (
  <div className="flex flex-col gap-0.5">
    {Array.from({ length: 5 }, (_, i) => (
      <div key={i} role="status" aria-label="正在加载聊天" className="flex h-8 items-center px-2.5">
        <Skeleton className="h-3.5 w-full" />
      </div>
    ))}
  </div>
);

/** 一行聊天:和工作台的对话行一样的样式;管理模式下是勾选框,平时按住可以拖进分组 */
export const ThreadListItem: FC = () => {
  const id = useAuiState((s) => s.threadListItem.id);
  const isRunning = useAuiState((s) => s.threadListItem.isRunning);
  const { managing, selected, toggle } = useContext(OrganizerContext);
  const [isRenaming, setIsRenaming] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const restoreFocusRef = useRef(false);
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id, disabled: managing || isRenaming });

  useEffect(() => {
    if (isRenaming || !restoreFocusRef.current) return;
    restoreFocusRef.current = false;
    triggerRef.current?.focus();
  }, [isRenaming]);

  if (managing) {
    const checked = selected.has(id);
    return (
      <div className={cn("ws-row", checked && "is-selected")}>
        <label className="ws-row-check">
          <input type="checkbox" checked={checked} onChange={() => toggle(id)} />
          <span>
            <ThreadListItemPrimitive.Title fallback="新聊天" />
          </span>
        </label>
      </div>
    );
  }

  return (
    <div ref={setNodeRef} {...attributes} {...listeners} tabIndex={-1} role={undefined}>
      <ThreadListItemPrimitive.Root className={cn("ws-row group", isDragging && "is-placeholder")}>
        {isRenaming ? (
          <ThreadListItemRename
            onDone={(restoreFocus) => {
              restoreFocusRef.current = restoreFocus;
              setIsRenaming(false);
            }}
          />
        ) : (
          <ThreadListItemPrimitive.Trigger ref={triggerRef} className="ws-row-title">
            {isRunning && <Loader2Icon className="me-1.5 size-3.5 shrink-0 animate-spin opacity-70" />}
            <span>
              <ThreadListItemPrimitive.Title fallback="新聊天" />
            </span>
            {isRunning && <span className="sr-only">正在生成</span>}
          </ThreadListItemPrimitive.Trigger>
        )}
        <ThreadListItemMore onRename={() => setIsRenaming(true)} />
      </ThreadListItemPrimitive.Root>
    </div>
  );
};

const ThreadListItemRename: FC<{ onDone: (restoreFocus: boolean) => void }> = ({ onDone }) => {
  const aui = useAui();
  const title = useAuiState((s) => s.threadListItem.title) ?? "";
  const [value, setValue] = useState(title);
  const inputRef = useRef<HTMLInputElement>(null);
  const settledRef = useRef(false);

  useEffect(() => {
    inputRef.current?.select();
  }, []);

  const commit = (restoreFocus: boolean) => {
    if (settledRef.current) return;
    settledRef.current = true;
    const next = value.trim();

    if (!next || next === title) {
      onDone(restoreFocus);
      return;
    }

    Promise.resolve()
      .then(() => aui.threadListItem.rename(next))
      .then(
        () => onDone(restoreFocus),
        () => {
          settledRef.current = false;
          if (restoreFocus) inputRef.current?.focus();
        },
      );
  };

  const cancel = () => {
    if (settledRef.current) return;
    settledRef.current = true;
    onDone(true);
  };

  return (
    <Input
      ref={inputRef}
      autoFocus
      aria-label="重命名聊天"
      value={value}
      className="h-7 min-w-0 flex-1 ps-2.5 pe-9 text-sm"
      onChange={(event) => setValue(event.target.value)}
      onBlur={() => commit(false)}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          commit(true);
        } else if (event.key === "Escape") {
          event.preventDefault();
          cancel();
        }
      }}
    />
  );
};

const ThreadListItemMore: FC<{ onRename: () => void }> = ({ onRename }) => (
  <ThreadListItemMorePrimitive.Root sharedFocusGroup>
    <ThreadListItemMorePrimitive.Trigger asChild>
      <Button
        variant="ghost"
        size="icon"
        className="data-[state=open]:bg-accent text-muted-foreground hover:text-foreground absolute end-1 top-1/2 size-7 -translate-y-1/2 rounded-lg p-0 opacity-0 group-hover:opacity-100 group-has-focus-visible:opacity-100 group-data-active:opacity-100 data-[state=open]:opacity-100"
      >
        <MoreHorizontalIcon className="size-[15px]" />
        <span className="sr-only">更多操作</span>
      </Button>
    </ThreadListItemMorePrimitive.Trigger>
    <ThreadListItemMorePrimitive.Content
      side="right"
      align="start"
      sideOffset={6}
      className="bg-popover/95 text-popover-foreground data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 data-[state=open]:animate-in data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[state=closed]:animate-out z-50 min-w-32 overflow-hidden rounded-xl border p-1.5 shadow-lg backdrop-blur-sm"
    >
      <ThreadListItemMorePrimitive.Item
        className="hover:bg-accent focus:bg-accent flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm outline-none select-none"
        onSelect={onRename}
      >
        <PencilIcon className="size-4" />
        重命名
      </ThreadListItemMorePrimitive.Item>
      <ThreadListItemPrimitive.Archive asChild>
        <ThreadListItemMorePrimitive.Item className="hover:bg-accent focus:bg-accent flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm outline-none select-none">
          <ArchiveIcon className="size-4" />
          归档
        </ThreadListItemMorePrimitive.Item>
      </ThreadListItemPrimitive.Archive>
      <ThreadListItemPrimitive.Delete asChild>
        <ThreadListItemMorePrimitive.Item className="text-destructive hover:bg-destructive/10 focus:bg-destructive/10 flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm outline-none select-none">
          <TrashIcon className="size-4" />
          删除
        </ThreadListItemMorePrimitive.Item>
      </ThreadListItemPrimitive.Delete>
    </ThreadListItemMorePrimitive.Content>
  </ThreadListItemMorePrimitive.Root>
);
