"use client";

import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { Maximize, Minus, Plus } from "lucide-react";
import { LoadProgress } from "@/components/load-progress";

const MIN = 1;
const MAX = 8;
const STEP = 1.25;

type View = { scale: number; x: number; y: number };
const FIT: View = { scale: 1, x: 0, y: 0 };

/**
 * 放大预览里的图片缩放:滚轮(触控板双指)以鼠标位置为中心缩放,放大后按住拖动平移,
 * 双击在「适应窗口 / 2 倍」之间切换;右下角有 − / 百分比 / + / 适应窗口,键盘 + − 0 也可以。
 * 换图时由外层用 key 重新挂载,回到适应窗口。
 */
export function ImageZoom({ src, alt, preview }: { src: string; alt: string; preview?: string }) {
  const stageRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<View>(FIT);
  const [loaded, setLoaded] = useState(false);
  // 原图由页面自己下载(能算出进度),下载完换成本地地址;下载不了(跨域、本地存储)时直接让 <img> 加载
  const direct = src.startsWith("blob:") || src.startsWith("data:");
  const [full, setFull] = useState<string>();
  const [progress, setProgress] = useState<{ loaded: number; total?: number }>({ loaded: 0 });
  useEffect(() => {
    if (direct) return;
    const controller = new AbortController();
    let objectUrl: string | undefined;
    void (async () => {
      try {
        const response = await fetch(src, { signal: controller.signal });
        if (!response.ok || !response.body) throw new Error("load failed");
        const total = Number(response.headers.get("content-length")) || undefined;
        const reader = response.body.getReader();
        const chunks: Uint8Array[] = [];
        let received = 0;
        let lastPaint = 0;
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          chunks.push(value);
          received += value.length;
          // 进度最多每 80ms 刷新一次
          if (performance.now() - lastPaint > 80) {
            lastPaint = performance.now();
            setProgress({ loaded: received, total });
          }
        }
        setProgress({ loaded: received, total: total || received });
        objectUrl = URL.createObjectURL(new Blob(chunks as BlobPart[], { type: response.headers.get("content-type") || "" }));
        setFull(objectUrl);
      } catch {
        if (!controller.signal.aborted) setFull(src);
      }
    })();
    return () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [src, direct]);
  const shown = direct ? src : full;
  const [dragging, setDragging] = useState(false);
  // 原生监听(滚轮、键盘)里读最新的缩放
  const viewRef = useRef(view);
  useLayoutEffect(() => { viewRef.current = view; }, [view]);
  const drag = useRef<{ id: number; x: number; y: number; from: View; moved: boolean } | null>(null);

  /** 把平移限制在图片边缘以内,缩小回 1 倍时自动居中 */
  const clamp = (next: View): View => {
    const stage = stageRef.current;
    if (!stage) return next;
    const scale = Math.min(MAX, Math.max(MIN, next.scale));
    const maxX = (stage.clientWidth * (scale - 1)) / 2;
    const maxY = (stage.clientHeight * (scale - 1)) / 2;
    return { scale, x: Math.min(maxX, Math.max(-maxX, next.x)), y: Math.min(maxY, Math.max(-maxY, next.y)) };
  };

  /** 按倍数缩放(在最新的缩放上乘),让 (px, py)(相对图片中心)这一点停在原处;连续滚轮也不会丢步 */
  const zoomBy = (factor: number, px = 0, py = 0) => {
    setView((current) => {
      const target = Math.min(MAX, Math.max(MIN, current.scale * factor));
      const ratio = target / current.scale;
      return clamp({ scale: target, x: px - (px - current.x) * ratio, y: py - (py - current.y) * ratio });
    });
  };

  const pointFrom = (clientX: number, clientY: number) => {
    const rect = stageRef.current!.getBoundingClientRect();
    return [clientX - rect.left - rect.width / 2, clientY - rect.top - rect.height / 2] as const;
  };

  // 滚轮要能 preventDefault(不让页面跟着滚),只能用原生监听
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const [px, py] = pointFrom(event.clientX, event.clientY);
      // 触控板双指缩放带 ctrlKey、幅度小,放大一点系数
      const factor = Math.exp(-event.deltaY * (event.ctrlKey ? 0.01 : 0.0018));
      zoomBy(factor, px, py);
    };
    stage.addEventListener("wheel", onWheel, { passive: false });
    return () => stage.removeEventListener("wheel", onWheel);
  });

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
      // 结果预览上又打开了参考素材预览:只有最上面那个弹框里的图响应
      const dialogs = document.querySelectorAll('[role="dialog"]');
      const own = stageRef.current?.closest('[role="dialog"]');
      if (own && dialogs.length && dialogs[dialogs.length - 1] !== own) return;
      if (event.key === "+" || event.key === "=") zoomBy(STEP);
      else if (event.key === "-" || event.key === "_") zoomBy(1 / STEP);
      else if (event.key === "0") setView(FIT);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || viewRef.current.scale <= 1) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY, from: viewRef.current, moved: false };
    setDragging(true);
  };
  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const state = drag.current;
    if (!state || state.id !== event.pointerId) return;
    const dx = event.clientX - state.x;
    const dy = event.clientY - state.y;
    if (Math.abs(dx) + Math.abs(dy) > 3) state.moved = true;
    setView(clamp({ ...state.from, x: state.from.x + dx, y: state.from.y + dy }));
  };
  const endDrag = () => {
    drag.current = null;
    setDragging(false);
  };

  const onDoubleClick = (event: React.MouseEvent) => {
    const [px, py] = pointFrom(event.clientX, event.clientY);
    if (viewRef.current.scale > 1) setView(FIT);
    else zoomBy(2, px, py);
  };

  const zoomed = view.scale > 1.001;
  return <div className={`image-zoom ${zoomed ? "is-zoomed" : ""} ${dragging ? "is-dragging" : ""}`}>
    <div className="image-zoom-stage" ref={stageRef} onPointerDown={onPointerDown} onPointerMove={onPointerMove}
      onPointerUp={endDrag} onPointerCancel={endDrag} onDoubleClick={onDoubleClick}>
      {/* 原图下载完之前:先显示卡片里已经有缓存的缩略图(稍微模糊),没有缩略图时占个位置,不会一片空白 */}
      {!loaded && (preview
        // eslint-disable-next-line @next/next/no-img-element
        ? <img className="image-viewer-img image-zoom-preview" src={preview} alt="" draggable={false}
          style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})` }} />
        : <div className="image-zoom-placeholder" />)}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {shown && <img className="image-viewer-img" src={shown} alt={alt} draggable={false} onLoad={() => setLoaded(true)}
        style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})`, ...(loaded ? {} : { display: "none" }) }} />}
      {!loaded && <LoadProgress label="加载原图"
        percent={progress.total ? (progress.loaded / progress.total) * 100 : undefined}
        loaded={progress.total ? progress.loaded : undefined} total={progress.total} />}
    </div>
    <div className="image-zoom-bar" onDoubleClick={(event) => event.stopPropagation()}>
      <button type="button" onClick={() => zoomBy(1 / STEP)} disabled={!zoomed} aria-label="缩小" title="缩小（-）">
        <Minus size={14} />
      </button>
      <button type="button" className="image-zoom-level" onClick={() => setView(FIT)} title="点击恢复适应窗口（0）">
        {Math.round(view.scale * 100)}%
      </button>
      <button type="button" onClick={() => zoomBy(STEP)} disabled={view.scale >= MAX} aria-label="放大" title="放大（+）">
        <Plus size={14} />
      </button>
      <button type="button" onClick={() => setView(FIT)} disabled={!zoomed} aria-label="适应窗口" title="适应窗口（0）">
        <Maximize size={13} />
      </button>
    </div>
  </div>;
}
