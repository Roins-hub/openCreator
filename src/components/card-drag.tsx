"use client";

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { createPortal } from "react-dom";
import { FileText } from "lucide-react";
import { MediaThumb } from "@/components/media-thumb";
import type { AssetKind, MediaRef } from "@/lib/types";

/**
 * 卡片式拖动(@ 选择素材、资产页共用):按住素材拖动,一张带阴影的卡片跟着鼠标走;
 * 移到放置目标(带 data-drop-target 的元素,例如文件夹标签)上时,目标放大、卡片被吸过去缩小停在它上方;
 * 松手后卡片飞进目标,目标回弹一下;没放到目标上就飞回原处。Esc 取消。
 * 组件外面的目标(例如输入框)再加 data-drop-external,悬停时由这里给它加 is-card-drop-hover 类。
 */
export type DragMedia = Pick<MediaRef, "path" | "name"> & { kind: AssetKind };

export type CardDragState = {
  paths: string[];
  media: DragMedia;
  x: number; y: number;
  /** 按下的位置相对卡片左上角的偏移(卡片不跳到鼠标中心) */
  grabX: number; grabY: number;
  origin: { left: number; top: number; width: number };
  target?: string;
  /** 目标是组件外面的大区域(输入框):卡片不吸到上方,跟着鼠标缩小 */
  external?: boolean;
  /** 吸附的目标:中心点和上沿(吸附时卡片停在目标正上方,不挡住它;松手时飞进中心) */
  anchor?: { x: number; y: number; top: number };
  phase: "drag" | "drop" | "cancel";
};

const DRAG_THRESHOLD = 6;
const HOVER_CLASS = "is-card-drop-hover";
const LANDED_CLASS = "is-card-drop-landed";

function targetAt(x: number, y: number) {
  const element = document.elementFromPoint?.(x, y) as HTMLElement | null;
  // data-drop-block:这块区域里不算外层的目标(例如 @ 选择框在输入框里面,悬在选择框上不算拖到输入框)
  const target = element?.closest<HTMLElement>("[data-drop-target], [data-drop-block]");
  if (!target?.dataset.dropTarget) return undefined;
  const rect = target.getBoundingClientRect();
  return {
    id: target.dataset.dropTarget, element: target, external: target.hasAttribute("data-drop-external"),
    anchor: { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, top: rect.top },
  };
}

/** 松手的位置(拖到输入框文字里时,按这个位置插入引用) */
export type DropPoint = { x: number; y: number };

export function useCardDrag(onDrop: (target: string, paths: string[], point: DropPoint) => void) {
  const [drag, setDrag] = useState<CardDragState>();
  const [dropTarget, setDropTarget] = useState<string>();
  const [landed, setLanded] = useState<string>();
  const releasedAt = useRef(0);
  // 松手时用最新的回调(拖动途中列表、文件夹可能变了)
  const onDropRef = useRef(onDrop);
  useEffect(() => { onDropRef.current = onDrop; });
  // 松手后用来吞掉那一下 click 的监听:组件卸载时也要撤掉
  const stopSwallowRef = useRef<() => void>(undefined);
  useEffect(() => () => stopSwallowRef.current?.(), []);

  /** 在素材上按下时调用;移动超过几像素才算拖动(只是点一下不受影响)。手指保留滚动,不触发拖动 */
  const begin = (event: ReactPointerEvent<HTMLElement>, media: DragMedia, paths: string[]) => {
    if (event.button !== 0 || event.pointerType === "touch" || !paths.length) return;
    if ((event.target as HTMLElement).closest("input, textarea, select, video, audio, a, [data-no-drag]")) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const startX = event.clientX;
    const startY = event.clientY;
    let started = false;
    let target: string | undefined;
    let last: DropPoint = { x: startX, y: startY };
    let hovered: HTMLElement | undefined;
    const base = {
      paths, media, grabX: startX - rect.left, grabY: startY - rect.top,
      origin: { left: rect.left, top: rect.top, width: rect.width },
    };
    const hover = (element?: HTMLElement) => {
      if (hovered === element) return;
      hovered?.classList.remove(HOVER_CLASS);
      hovered = element;
      hovered?.classList.add(HOVER_CLASS);
    };
    const finish = (dropped: boolean) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancel);
      window.removeEventListener("keydown", key, true);
      document.body.classList.remove("is-card-dragging");
      if (!started) return;
      releasedAt.current = Date.now();
      // 松手后浏览器会补一个 click(落在松手处的元素上):吞掉,免得误触发「放大查看」「选中」之类。
      // 只管紧跟着的这一下:用户再按下(新的操作)或过了一会儿就撤掉
      stopSwallowRef.current?.();
      const swallow = (click: MouseEvent) => { click.stopPropagation(); click.preventDefault(); stop(); };
      const stop = () => {
        window.removeEventListener("click", swallow, true);
        window.removeEventListener("pointerdown", stop, true);
        window.clearTimeout(timer);
        if (stopSwallowRef.current === stop) stopSwallowRef.current = undefined;
      };
      const timer = window.setTimeout(stop, 400);
      window.addEventListener("click", swallow, true);
      window.addEventListener("pointerdown", stop, true);
      stopSwallowRef.current = stop;
      const into = dropped ? target : undefined;
      const element = hovered;
      hover(undefined);
      setDropTarget(undefined);
      setDrag((current) => current && { ...current, phase: into ? "drop" : "cancel" });
      if (into) {
        onDropRef.current(into, paths, last);
        setLanded(into);
        element?.classList.add(LANDED_CLASS);
        window.setTimeout(() => {
          setLanded((value) => value === into ? undefined : value);
          element?.classList.remove(LANDED_CLASS);
        }, 520);
      }
      window.setTimeout(() => setDrag(undefined), 280);
    };
    const move = (moved: PointerEvent) => {
      if (!started) {
        if (Math.hypot(moved.clientX - startX, moved.clientY - startY) < DRAG_THRESHOLD) return;
        started = true;
        document.body.classList.add("is-card-dragging");
      }
      last = { x: moved.clientX, y: moved.clientY };
      const hit = targetAt(moved.clientX, moved.clientY);
      target = hit?.id;
      hover(hit?.external ? hit.element : undefined);
      setDropTarget(target);
      setDrag({ ...base, x: moved.clientX, y: moved.clientY, target, external: hit?.external, anchor: hit?.anchor, phase: "drag" });
    };
    const up = () => finish(true);
    const cancel = () => finish(false);
    const key = (pressed: KeyboardEvent) => {
      if (pressed.key !== "Escape" || !started) return;
      pressed.preventDefault();
      pressed.stopPropagation();
      finish(false);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", cancel);
    window.addEventListener("keydown", key, true);
  };

  /** 拖完松手后浏览器还会补一个 click:在点击处理里先问一下,是就跳过 */
  const justDropped = () => Date.now() - releasedAt.current < 400;

  const overlay = drag && typeof document !== "undefined" ? createPortal(<DragCard drag={drag} />, document.body) : null;
  return { drag, dropTarget, landed, begin, justDropped, overlay };
}

/**
 * 拖动中的卡片。外层管位置(跟手;到了目标上方被吸过去,带一点弹性),
 * 内层管姿态(拿起时微微倾斜放大;吸附时缩小摆正;放进去时缩没;取消时飞回原处)。
 */
function DragCard({ drag }: { drag: CardDragState }) {
  const { origin, phase } = drag;
  // 卡片最宽 150px(资产页的卡片很宽,原样大小拖着太笨重);按住的位置按比例换算
  const width = Math.min(origin.width, 150);
  const ratio = width / origin.width;
  const free = { x: drag.x - drag.grabX * ratio, y: drag.y - drag.grabY * ratio };
  const half = width / 2;
  const SNAP_SCALE = .46;
  // 吸附:卡片缩小后停在目标正上方(不挡住放大的目标),只保留一点点跟手的偏移;大区域(输入框)不吸附
  const snapped = drag.anchor && !drag.external && {
    x: drag.anchor.x + (drag.x - drag.anchor.x) * .12 - half,
    y: drag.anchor.top - 10 - width * SNAP_SCALE / 2 - half + (drag.y - drag.anchor.y) * .08,
  };
  const into = drag.external ? { x: drag.x - half, y: drag.y - half } : drag.anchor && { x: drag.anchor.x - half, y: drag.anchor.y - half };
  const position = phase === "cancel" ? { x: origin.left, y: origin.top }
    : phase === "drop" && into ? into
      : snapped || free;
  const state = phase === "drag" ? (snapped ? "is-snapped" : drag.external ? "is-over-area" : "is-free") : `is-${phase}`;
  // 换了吸附目标时重新挂载内层,再播一次「被吸住」的弹跳
  return <div className={`card-drag ${state}`} aria-hidden="true"
    style={{ width, transform: `translate3d(${position.x}px, ${position.y}px, 0)` }}>
    <div key={phase === "drag" ? drag.target || "free" : "end"} className={`card-drag-body ${drag.paths.length > 1 ? "is-stack" : ""}`}>
      <span className="card-drag-thumb">{drag.media.kind === "file"
        ? <span className="card-drag-file"><FileText size={26} /><b>{(drag.media.name.split(".").pop() || "").toUpperCase()}</b></span>
        : <MediaThumb media={{ ...drag.media, kind: drag.media.kind }} />}</span>
      <span className="card-drag-name">{drag.media.name}</span>
      {drag.paths.length > 1 && <b className="card-drag-count">{drag.paths.length}</b>}
    </div>
  </div>;
}
