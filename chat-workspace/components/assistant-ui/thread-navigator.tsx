"use client";

import { useAuiState } from "@assistant-ui/react";
import { SearchIcon, XIcon } from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

/**
 * 聊天右侧的提示词导航(和视频工作台一致):右边一列短横线对应自己发过的每条消息,
 * 鼠标移上去展开卡片,可以搜索本对话的提示词,点击跳到那条消息。消息不到 3 条时不显示。
 */
interface NavNode {
  id: string;
  preview: string;
  text: string;
}

const MIN_NODES = 3;
/** 细线刻度长度:离焦点越近越长(像放大镜),远处是短刻度(和视频工作台一致) */
const TICK_WIDTHS = [30, 22, 17, 13];
const tickWidth = (index: number, focus: number) => TICK_WIDTHS[Math.abs(index - focus)] ?? 9;
/** 卡片列表的层次:离焦点几条(带方向,最多算到 ±4),焦点那条凸起,越远越往里凹 */
const DEPTH_STEPS = 4;
const depthOffset = (position: number, focus: number) =>
  Math.max(-DEPTH_STEPS, Math.min(DEPTH_STEPS, position - focus));

export const messageAnchorId = (id: string) => `chat-msg-${id}`;

type Part = { type: string; text?: string };
type ThreadMessageLike = { id: string; role: string; content: readonly Part[]; attachments?: readonly unknown[] };

function navNodes(messages: readonly ThreadMessageLike[]): NavNode[] {
  return messages
    .filter((message) => message.role === "user")
    .map((message) => {
      const text = message.content
        .map((part) => (part.type === "text" ? part.text || "" : ""))
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();
      const fallback = message.attachments?.length ? "附件消息" : "空消息";
      const full = text || fallback;
      return { id: message.id, text: full, preview: full.length > 72 ? `${full.slice(0, 72)}…` : full };
    });
}

/** 包含全部关键词(空格分隔,不分大小写) */
function search(nodes: NavNode[], query: string) {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return nodes;
  return nodes.filter((node) => words.every((word) => node.text.toLowerCase().includes(word)));
}

const viewport = () => document.querySelector<HTMLElement>('[data-slot="aui_thread-viewport"]');

export function ThreadNavigator() {
  const messages = useAuiState((s) => s.thread.messages) as unknown as readonly ThreadMessageLike[];
  const nodes = useMemo(() => navNodes(messages), [messages]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [query, setQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const searching = query.trim().length > 0;
  const matches = useMemo(() => search(nodes, query), [nodes, query]);
  const expanded = hovered || focused || searching;

  // 展开时把列表滚到当前读到的那条(只滚列表自己,不带动页面)
  useLayoutEffect(() => {
    const list = listRef.current;
    if (!expanded || searching || !list) return;
    const active = list.querySelector<HTMLElement>("button.active");
    if (active) list.scrollTop = active.offsetTop - list.clientHeight / 2 + active.offsetHeight / 2;
  }, [expanded, searching]);
  const enough = nodes.length >= MIN_NODES;

  // 滚动时高亮当前读到的那条(视口上方约 1/3 处)
  useEffect(() => {
    const root = viewport();
    if (!root || !enough) return;
    const update = () => {
      const rect = root.getBoundingClientRect();
      const readingLine = rect.top + rect.height * 0.32;
      let next = 0;
      nodes.forEach((node, index) => {
        const element = document.getElementById(messageAnchorId(node.id));
        if (element && element.getBoundingClientRect().top <= readingLine) next = index;
      });
      setActiveIndex(next);
    };
    update();
    root.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => {
      root.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, [enough, nodes]);

  // 条数多、细线放不下时右侧细线可以滚动:让当前这条留在中间(只滚细线自己)
  const railRef = useRef<HTMLDivElement>(null);
  // 鼠标在细线上指着哪一根:放大效果跟着鼠标走;移开后回到当前读到的那根
  const [pointed, setPointed] = useState<number>();
  const focusIndex = pointed ?? activeIndex;
  // 卡片列表的焦点:鼠标在列表里指着的那条,其次是细线上指着的,都没有就是当前读到的
  const [listHover, setListHover] = useState<number>();
  const cardFocus = listHover ?? focusIndex;
  const panelRef = useRef<HTMLDivElement>(null);

  // 鼠标在细线上移动时,列表跟着滚到对应那条(列表里的鼠标不滚,免得条目从鼠标底下跑掉)
  useEffect(() => {
    const list = listRef.current;
    if (pointed === undefined || !expanded || searching || !list) return;
    const item = list.querySelector<HTMLElement>(`button[data-index="${pointed}"]`);
    if (item) list.scrollTo({ top: item.offsetTop - list.clientHeight / 2 + item.offsetHeight / 2, behavior: "smooth" });
  }, [pointed, expanded, searching]);
  useEffect(() => {
    const rail = railRef.current;
    const active = rail?.querySelector<HTMLElement>("button.active");
    if (!rail || !active || rail.scrollHeight <= rail.clientHeight) return;
    rail.scrollTop = active.offsetTop - rail.clientHeight / 2 + active.offsetHeight / 2;
  }, [activeIndex, nodes.length]);

  if (!enough) return null;

  const jump = (id: string) =>
    document.getElementById(messageAnchorId(id))?.scrollIntoView({ behavior: "smooth", block: "start" });
  const indexOf = (id: string) => nodes.findIndex((node) => node.id === id);
  // 卡片里列出全部提示词(可滚动),输入关键词时只列匹配项;右侧细线每条提示词一根,一一对应
  const list = searching ? matches : nodes;
  const focusPosition = list.findIndex((node) => indexOf(node.id) === cardFocus);

  // 整个卡片朝鼠标那边微微翘起(鼠标所在的一侧凸出来)
  const tilt = (event: React.MouseEvent<HTMLDivElement>) => {
    const panel = panelRef.current;
    if (!panel) return;
    const rect = panel.getBoundingClientRect();
    const x = (event.clientX - rect.left) / rect.width - 0.5;
    const y = (event.clientY - rect.top) / rect.height - 0.5;
    panel.style.setProperty("--ry", `${(-x * 7).toFixed(2)}deg`);
    panel.style.setProperty("--rx", `${(y * 7).toFixed(2)}deg`);
  };
  const untilt = () => {
    panelRef.current?.style.removeProperty("--ry");
    panelRef.current?.style.removeProperty("--rx");
  };

  return (
    <nav
      className={`thread-navigator ${expanded ? "expanded" : ""}`}
      aria-label="对话快速导航"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false);
      }}
    >
      {/* 卡片一直挂着,用 is-open 切换:弹出、收起都有过渡 */}
      <div
          className={`thread-map-card ${searching ? "searching" : ""} ${expanded ? "is-open" : ""}`}
          inert={!expanded}
          aria-hidden={!expanded}
        >
          <div className="thread-map-panel" ref={panelRef} onMouseMove={tilt} onMouseLeave={untilt}>
          <label className="thread-map-search">
            <SearchIcon className="size-3.5" />
            <input
              ref={searchRef}
              type="search"
              value={query}
              placeholder={`搜索本对话的 ${nodes.length} 条提示词`}
              aria-label="搜索本对话的提示词"
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  event.stopPropagation();
                  setQuery("");
                }
                if (event.key === "Enter" && matches[0]) jump(matches[0].id);
              }}
            />
            {searching && (
              <button
                type="button"
                className="thread-map-clear"
                aria-label="清空搜索"
                onClick={() => {
                  setQuery("");
                  searchRef.current?.focus();
                }}
              >
                <XIcon className="size-3.5" />
              </button>
            )}
          </label>
          {searching && (
            <p className="thread-map-count">{matches.length ? `找到 ${matches.length} 条` : "没有匹配的提示词"}</p>
          )}
          {/* 像滚轮一样有层次:焦点那条凸起,上下越远越往里凹、越淡(--o 带方向的距离,--d 距离) */}
          <div className="thread-map-list" ref={listRef} onMouseLeave={() => setListHover(undefined)}>
            {list.map((node, position) => {
              const index = indexOf(node.id);
              const offset = focusPosition < 0 ? 0 : depthOffset(position, focusPosition);
              return (
                <button
                  type="button"
                  key={node.id}
                  data-index={index}
                  className={`${index === activeIndex ? "active" : ""} ${focusPosition >= 0 && offset === 0 ? "focus" : ""}`}
                  style={{ "--o": offset, "--d": Math.abs(offset) } as React.CSSProperties}
                  onMouseEnter={() => setListHover(index)}
                  onClick={() => jump(node.id)}
                  title={node.text}
                >
                  {searching && <em>{index + 1}</em>}
                  {node.preview}
                </button>
              );
            })}
          </div>
          </div>
        </div>
      {/* 条数越多细线越密(每根 16px 到 4px),最多占屏幕高度的六成,再多就滚动 */}
      <div
        className="thread-map-rail"
        ref={railRef}
        onMouseLeave={() => setPointed(undefined)}
        style={{ "--tick": `clamp(4px, calc(60vh / ${nodes.length}), 16px)` } as React.CSSProperties}
      >
        {nodes.map((node, index) => (
          <button
            type="button"
            key={node.id}
            className={`${index === activeIndex ? "active" : ""} ${index === pointed ? "pointed" : ""}`}
            style={{ "--w": `${tickWidth(index, focusIndex)}px` } as React.CSSProperties}
            onMouseEnter={() => setPointed(index)}
            onClick={() => jump(node.id)}
            aria-label={`跳转到第 ${index + 1} 条：${node.preview}`}
          />
        ))}
      </div>
    </nav>
  );
}
