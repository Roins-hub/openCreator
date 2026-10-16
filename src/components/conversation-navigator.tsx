"use client";

import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { Search, X } from "lucide-react";
import type { Message } from "@/lib/types";
import { navigationNodes, navigationWindow, searchNavigation } from "@/lib/conversation-navigation";

export function ConversationNavigator({
  messages,
  scrollRootRef,
}: {
  messages: Message[];
  scrollRootRef: RefObject<HTMLDivElement | null>;
}) {
  const nodes = useMemo(() => navigationNodes(messages), [messages]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [query, setQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  const searching = query.trim().length > 0;
  // 输入了关键词就列出全部匹配项(可滚动),否则只列当前位置附近的几条
  const matches = useMemo(() => searchNavigation(nodes, query), [nodes, query]);
  const visible = navigationWindow(nodes, activeIndex);
  const expanded = hovered || focused || searching;

  useEffect(() => {
    const root = scrollRootRef.current;
    if (!root || nodes.length < 5) return;
    const update = () => {
      const rootRect = root.getBoundingClientRect();
      const readingLine = rootRect.top + rootRect.height * .32;
      let nextIndex = 0;
      nodes.forEach((node, index) => {
        const element = document.getElementById(`message-${node.id}`);
        if (element && element.getBoundingClientRect().top <= readingLine) nextIndex = index;
      });
      setActiveIndex(nextIndex);
    };
    update();
    root.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => {
      root.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, [nodes, scrollRootRef]);

  if (nodes.length < 5) return null;

  const jump = (id: string) => {
    document.getElementById(`message-${id}`)
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  const indexOf = (id: string) => nodes.findIndex((item) => item.id === id);
  const list = searching ? matches : visible;

  return <nav className={`conversation-navigator ${expanded ? "expanded" : ""}`}
    aria-label="对话快速导航"
    onMouseEnter={() => setHovered(true)}
    onMouseLeave={() => setHovered(false)}
    onFocus={() => setFocused(true)}
    onBlur={(event) => {
      if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false);
    }}>
    {expanded && <div className={`conversation-map-card ${searching ? "searching" : ""}`}>
      <label className="conversation-map-search">
        <Search size={13} />
        <input ref={searchRef} type="search" value={query} placeholder={`搜索本对话的 ${nodes.length} 条提示词`}
          aria-label="搜索本对话的提示词"
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") { event.stopPropagation(); setQuery(""); }
            if (event.key === "Enter" && matches[0]) jump(matches[0].id);
          }} />
        {searching && <button type="button" className="conversation-map-clear" aria-label="清空搜索"
          onClick={() => { setQuery(""); searchRef.current?.focus(); }}><X size={13} /></button>}
      </label>
      {searching && <p className="conversation-map-count">{matches.length ? `找到 ${matches.length} 条` : "没有匹配的提示词"}</p>}
      <div className="conversation-map-list">
        {list.map((node) => {
          const index = indexOf(node.id);
          return <button type="button" key={node.id}
            className={index === activeIndex ? "active" : ""}
            onClick={() => jump(node.id)} title={node.text}>
            {searching && <em>{index + 1}</em>}{node.preview}
          </button>;
        })}
      </div>
    </div>}
    <div className="conversation-map-rail">
      {visible.map((node) => {
        const index = indexOf(node.id);
        return <button type="button" key={node.id}
          className={index === activeIndex ? "active" : ""}
          onClick={() => jump(node.id)}
          aria-label={`跳转到：${node.preview}`} />;
      })}
    </div>
  </nav>;
}
