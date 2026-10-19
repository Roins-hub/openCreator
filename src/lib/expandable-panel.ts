"use client";

import {
  useCallback, useEffect, useLayoutEffect, useRef, useState,
  type CSSProperties, type PointerEvent as ReactPointerEvent, type RefObject,
} from "react";
import { flushSync } from "react-dom";

/**
 * 输入框「放大编辑」:输入框本身从原位置平滑地飞到屏幕中间变成大面板(素材、附件、工具栏都还在),
 * 四条边和四个角都能拖动改变大小,拖标题栏可以移动;收起时再飞回原位。
 * 原位置留一个同样高度的占位,页面不会跳。面板大小记在当前浏览器里,下次打开沿用。
 */
export interface PanelRect { left: number; top: number; width: number; height: number }
export type PanelEdge = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";
export const PANEL_EDGES: PanelEdge[] = ["n", "s", "e", "w", "ne", "nw", "se", "sw"];

const MARGIN = 12;
const OPEN_MS = 360;
const CLOSE_MS = 280;
const EASING = "cubic-bezier(.22, 1, .36, 1)";

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);
const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const frame = (rect: PanelRect) =>
  ({ left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px` });

/** 让面板整个留在屏幕内 */
function fitViewport(rect: PanelRect, minWidth: number, minHeight: number): PanelRect {
  const maxWidth = window.innerWidth - MARGIN * 2;
  const maxHeight = window.innerHeight - MARGIN * 2;
  const width = clamp(rect.width, Math.min(minWidth, maxWidth), maxWidth);
  const height = clamp(rect.height, Math.min(minHeight, maxHeight), maxHeight);
  return {
    width, height,
    left: clamp(rect.left, MARGIN, window.innerWidth - MARGIN - width),
    top: clamp(rect.top, MARGIN, window.innerHeight - MARGIN - height),
  };
}

/** 拖某条边 / 某个角:对边保持不动 */
function resizeRect(start: PanelRect, edge: PanelEdge, dx: number, dy: number, minWidth: number, minHeight: number) {
  let { left, top } = start;
  let right = start.left + start.width;
  let bottom = start.top + start.height;
  if (edge.includes("w")) left = clamp(start.left + dx, MARGIN, right - minWidth);
  if (edge.includes("e")) right = clamp(right + dx, left + minWidth, window.innerWidth - MARGIN);
  if (edge.includes("n")) top = clamp(start.top + dy, MARGIN, bottom - minHeight);
  if (edge.includes("s")) bottom = clamp(bottom + dy, top + minHeight, window.innerHeight - MARGIN);
  return { left, top, width: right - left, height: bottom - top };
}

function readSize(key: string) {
  try {
    const value = JSON.parse(window.localStorage.getItem(key) || "null") as { width?: unknown; height?: unknown } | null;
    return typeof value?.width === "number" && typeof value.height === "number" ? { width: value.width, height: value.height } : null;
  } catch { return null; }
}

function writeSize(key: string, rect: PanelRect) {
  try { window.localStorage.setItem(key, JSON.stringify({ width: Math.round(rect.width), height: Math.round(rect.height) })); }
  catch { /* 隐私模式等无法写入时忽略 */ }
}

/** 拖动期间:全局光标跟着变,页面文字不被选中 */
function dragSession(event: ReactPointerEvent, cursor: string, onMove: (dx: number, dy: number) => void, onEnd: () => void) {
  const x = event.clientX;
  const y = event.clientY;
  const target = event.currentTarget as HTMLElement;
  target.setPointerCapture(event.pointerId);
  const root = document.documentElement;
  const previous = { cursor: root.style.cursor, select: root.style.userSelect };
  root.style.cursor = cursor;
  root.style.userSelect = "none";
  const move = (next: PointerEvent) => onMove(next.clientX - x, next.clientY - y);
  const end = () => {
    target.removeEventListener("pointermove", move);
    target.removeEventListener("pointerup", end);
    target.removeEventListener("pointercancel", end);
    root.style.cursor = previous.cursor;
    root.style.userSelect = previous.select;
    onEnd();
  };
  target.addEventListener("pointermove", move);
  target.addEventListener("pointerup", end);
  target.addEventListener("pointercancel", end);
}

const EDGE_CURSOR: Record<PanelEdge, string> = {
  n: "ns-resize", s: "ns-resize", e: "ew-resize", w: "ew-resize",
  ne: "nesw-resize", sw: "nesw-resize", nw: "nwse-resize", se: "nwse-resize",
};

export function useExpandablePanel({
  panelRef, holderRef, storageKey, minWidth = 420, minHeight = 280, onOpened, onClosed,
}: {
  /** 会被放大的元素 */
  panelRef: RefObject<HTMLElement | null>;
  /** 包着它、留在原位置的占位元素 */
  holderRef: RefObject<HTMLElement | null>;
  storageKey: string;
  minWidth?: number;
  minHeight?: number;
  /** 飞到中间之后(比如把光标放进编辑区) */
  onOpened?: () => void;
  /** 回到原位之后 */
  onClosed?: () => void;
}) {
  const [state, setState] = useState<"closed" | "open" | "closing">("closed");
  const [rect, setRect] = useState<PanelRect>();
  const [holderHeight, setHolderHeight] = useState<number>();
  const rectRef = useRef<PanelRect | undefined>(undefined);
  const fromRef = useRef<PanelRect | undefined>(undefined);
  const animationRef = useRef<Animation | undefined>(undefined);
  const callbacks = useRef({ onOpened, onClosed });
  useEffect(() => { callbacks.current = { onOpened, onClosed }; });

  const place = useCallback((next: PanelRect | undefined) => {
    rectRef.current = next;
    setRect(next);
  }, []);

  const open = useCallback(() => {
    const panel = panelRef.current;
    if (!panel || state !== "closed") return;
    const from = panel.getBoundingClientRect();
    const saved = readSize(storageKey);
    const width = saved?.width ?? Math.min(920, window.innerWidth * 0.78);
    const height = saved?.height ?? Math.min(640, window.innerHeight * 0.74);
    fromRef.current = { left: from.left, top: from.top, width: from.width, height: from.height };
    setHolderHeight(from.height);
    place(fitViewport({ left: (window.innerWidth - width) / 2, top: (window.innerHeight - height) / 2, width, height },
      minWidth, minHeight));
    setState("open");
  }, [minHeight, minWidth, panelRef, place, state, storageKey]);

  // 变成固定定位后,从原来的位置和大小过渡到面板
  useLayoutEffect(() => {
    const from = fromRef.current;
    const panel = panelRef.current;
    if (state !== "open" || !from || !panel || !rect) return;
    fromRef.current = undefined;
    const done = () => callbacks.current.onOpened?.();
    if (reducedMotion()) { done(); return; }
    animationRef.current?.cancel();
    const animation = panel.animate([frame(from), frame(rect)], { duration: OPEN_MS, easing: EASING });
    animationRef.current = animation;
    animation.onfinish = done;
  }, [panelRef, rect, state]);

  const close = useCallback(() => {
    const panel = panelRef.current;
    const holder = holderRef.current;
    if (state !== "open") return;
    const finish = () => {
      flushSync(() => {
        setState("closed");
        place(undefined);
        setHolderHeight(undefined);
      });
      callbacks.current.onClosed?.();
    };
    animationRef.current?.cancel();
    if (!panel || !holder || reducedMotion()) { finish(); return; }
    const current = panel.getBoundingClientRect();
    // 一开始收起就换回普通输入框的排版(仍浮在原处),之后只有外框在缩小,落地时内容不会再跳
    flushSync(() => setState("closing"));
    // 按现在的内容量出回到原位后的真实高度,占位也改成这个高度,终点和最终布局完全一致
    const width = holder.getBoundingClientRect().width;
    const saved = { width: panel.style.width, height: panel.style.height };
    panel.style.width = `${width}px`;
    panel.style.height = "auto";
    const height = panel.offsetHeight;
    panel.style.width = saved.width;
    panel.style.height = saved.height;
    flushSync(() => setHolderHeight(height));
    const target = holder.getBoundingClientRect();
    const animation = panel.animate([
      frame({ left: current.left, top: current.top, width: current.width, height: current.height }),
      frame({ left: target.left, top: target.top, width: target.width, height }),
    ], { duration: CLOSE_MS, easing: EASING, fill: "forwards" });
    animationRef.current = animation;
    // 先切回原位(同步渲染),再去掉动画的最后一帧,中间不会闪
    animation.onfinish = () => { finish(); animation.cancel(); };
  }, [holderRef, panelRef, place, state]);

  /** 面板浮在页面上(打开中或正在收起) */
  const floating = state !== "closed";
  /** 内容按放大排版(收起动画一开始就换回普通排版) */
  const expanded = state === "open";

  // 窗口变小时面板跟着缩进屏幕;Esc 收起(输入框自己处理过的 Esc 不算)
  useEffect(() => {
    if (state !== "open") return;
    const resize = () => { if (rectRef.current) place(fitViewport(rectRef.current, minWidth, minHeight)); };
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.defaultPrevented && !event.isComposing) { event.preventDefault(); close(); }
    };
    window.addEventListener("resize", resize);
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("resize", resize);
      window.removeEventListener("keydown", key);
    };
  }, [close, minHeight, minWidth, place, state]);

  const startResize = (edge: PanelEdge) => (event: ReactPointerEvent) => {
    const start = rectRef.current;
    if (event.button !== 0 || !start || state !== "open") return;
    event.preventDefault();
    event.stopPropagation();
    dragSession(event, EDGE_CURSOR[edge],
      (dx, dy) => place(resizeRect(start, edge, dx, dy, minWidth, minHeight)),
      () => { if (rectRef.current) writeSize(storageKey, rectRef.current); });
  };

  /** 按住标题栏拖动面板(按钮上按下不算) */
  const startMove = (event: ReactPointerEvent) => {
    const start = rectRef.current;
    if (event.button !== 0 || !start || state !== "open") return;
    if ((event.target as HTMLElement).closest("button, a, input, textarea, select, [contenteditable='true']")) return;
    event.preventDefault();
    dragSession(event, "grabbing",
      (dx, dy) => place(fitViewport({ ...start, left: start.left + dx, top: start.top + dy }, minWidth, minHeight)),
      () => undefined);
  };

  const panelStyle: CSSProperties | undefined = floating && rect
    ? { position: "fixed", left: rect.left, top: rect.top, width: rect.width, height: rect.height, margin: 0 }
    : undefined;
  const holderStyle: CSSProperties | undefined = floating && holderHeight ? { minHeight: holderHeight } : undefined;

  return {
    floating, expanded, closing: state === "closing", open, close,
    toggle: () => (state === "closed" ? open() : close()),
    panelStyle, holderStyle, startResize, startMove,
  };
}
