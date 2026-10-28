"use client";

import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Brush, Check, ChevronDown, Crop, Download, Droplets, Eraser, FlipHorizontal2, FlipVertical2, FolderPlus, Grid3x3,
  ImagePlus, Loader2, Pencil, Redo2, RotateCcw, RotateCw, SlidersHorizontal, Undo2,
} from "lucide-react";
import { useSlidingThumb } from "@/components/segmented";
import { apiKeyHeaders } from "@/lib/api-key";
import { uploadMedia } from "@/lib/direct-upload";

/**
 * 编辑完的图片能送去哪里:页面自己提供(工作台能「添加到输入框」,资产页没有输入框就不给)。
 * 下载和「存入素材库」到处都能用。
 */
export type ImageEditTargets = {
  /** 作为参考素材加到输入框(会顺带存进素材库) */
  attach?: (file: File) => void;
  /** 存入素材库之后,让页面刷新素材列表 */
  saved?: () => void;
};
export const ImageEditContext = createContext<ImageEditTargets>({});

type Tool = "crop" | "adjust" | "draw" | "mosaic" | "blur" | "erase";
type Adjust = { brightness: number; contrast: number; saturation: number; warmth: number };
type Rect = { x: number; y: number; w: number; h: number };
type Snapshot = { work: HTMLCanvasElement; base: HTMLCanvasElement };

const TOOLS: { id: Tool; label: string; icon: typeof Crop; hint: string }[] = [
  { id: "crop", label: "裁剪", icon: Crop, hint: "裁剪、旋转、翻转、拉直" },
  { id: "adjust", label: "调整", icon: SlidersHorizontal, hint: "亮度、对比度、饱和度、色温" },
  { id: "draw", label: "涂鸦", icon: Brush, hint: "用画笔在图上画" },
  { id: "mosaic", label: "马赛克", icon: Grid3x3, hint: "涂过的地方打上马赛克" },
  { id: "blur", label: "涂抹", icon: Droplets, hint: "涂过的地方变模糊" },
  { id: "erase", label: "擦除", icon: Eraser, hint: "擦掉涂鸦、马赛克和涂抹,露出原来的图" },
];
const NO_ADJUST: Adjust = { brightness: 0, contrast: 0, saturation: 0, warmth: 0 };
const FULL: Rect = { x: 0, y: 0, w: 1, h: 1 };
const RATIOS: { label: string; value: number | null }[] = [
  { label: "自由", value: null }, { label: "原比例", value: -1 }, { label: "1:1", value: 1 },
  { label: "4:3", value: 4 / 3 }, { label: "3:4", value: 3 / 4 }, { label: "16:9", value: 16 / 9 }, { label: "9:16", value: 9 / 16 },
];
const COLORS = ["#ffffff", "#111111", "#e5484d", "#f5a524", "#30a46c", "#3e63dd", "#8e4ec6"];

function canvasOf(width: number, height: number) {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  return canvas;
}
function copyOf(source: HTMLCanvasElement) {
  const canvas = canvasOf(source.width, source.height);
  canvas.getContext("2d")!.drawImage(source, 0, 0);
  return canvas;
}
const context = (canvas: HTMLCanvasElement) => canvas.getContext("2d", { willReadFrequently: false })!;

/** 拉直时为了不露出空角要放大的倍数:转过 angle 度的图里,能放下的同比例最大矩形 */
export function straightenScale(width: number, height: number, degrees: number) {
  const angle = Math.abs(degrees) * Math.PI / 180;
  const cos = Math.cos(angle), sin = Math.sin(angle);
  return Math.min(width / (width * cos + height * sin), height / (width * sin + height * cos));
}

/** 亮度 / 对比度 / 饱和度 / 色温,各 -100 ~ 100,直接改像素 */
export function applyAdjust(data: Uint8ClampedArray, { brightness, contrast, saturation, warmth }: Adjust) {
  const add = brightness * 1.28;
  const c = contrast * 1.28;
  const factor = (259 * (c + 255)) / (255 * (259 - c));
  const sat = 1 + saturation / 100;
  const warm = warmth * 0.5;
  for (let i = 0; i < data.length; i += 4) {
    let r = factor * (data[i] + add - 128) + 128;
    let g = factor * (data[i + 1] + add - 128) + 128;
    let b = factor * (data[i + 2] + add - 128) + 128;
    const gray = 0.299 * r + 0.587 * g + 0.114 * b;
    r = gray + (r - gray) * sat + warm;
    g = gray + (g - gray) * sat + warm * 0.2;
    b = gray + (b - gray) * sat - warm;
    data[i] = r; data[i + 1] = g; data[i + 2] = b;
  }
}

/** 马赛克:先缩小再不平滑地放大,格子对齐整张图 */
function pixelated(source: HTMLCanvasElement) {
  const cell = Math.max(8, Math.round(Math.max(source.width, source.height) / 90));
  const small = canvasOf(Math.ceil(source.width / cell), Math.ceil(source.height / cell));
  const smallContext = context(small);
  smallContext.imageSmoothingQuality = "high";
  smallContext.drawImage(source, 0, 0, small.width, small.height);
  const out = canvasOf(source.width, source.height);
  const outContext = context(out);
  outContext.imageSmoothingEnabled = false;
  outContext.drawImage(small, 0, 0, small.width * cell, small.height * cell);
  return out;
}

/** 模糊:缩小两次再放大(各浏览器都支持,不依赖画布的 filter) */
function blurred(source: HTMLCanvasElement) {
  const factor = Math.max(6, Math.round(Math.max(source.width, source.height) / 160));
  const small = canvasOf(source.width / factor, source.height / factor);
  const smallContext = context(small);
  smallContext.imageSmoothingQuality = "high";
  smallContext.drawImage(source, 0, 0, small.width, small.height);
  const tiny = canvasOf(small.width / 2, small.height / 2);
  context(tiny).drawImage(small, 0, 0, tiny.width, tiny.height);
  smallContext.clearRect(0, 0, small.width, small.height);
  smallContext.drawImage(tiny, 0, 0, small.width, small.height);
  const out = canvasOf(source.width, source.height);
  const outContext = context(out);
  outContext.imageSmoothingQuality = "high";
  outContext.drawImage(small, 0, 0, out.width, out.height);
  return out;
}

function clampRect(rect: Rect): Rect {
  const w = Math.min(1, Math.max(0.02, rect.w));
  const h = Math.min(1, Math.max(0.02, rect.h));
  return { w, h, x: Math.min(1 - w, Math.max(0, rect.x)), y: Math.min(1 - h, Math.max(0, rect.y)) };
}

/** 按比例(宽 / 高,按像素算)在图里放一个尽量大的居中裁剪框 */
function ratioRect(ratio: number, width: number, height: number): Rect {
  const imageRatio = width / height;
  return ratio > imageRatio
    ? { x: 0, w: 1, h: imageRatio / ratio, y: (1 - imageRatio / ratio) / 2 }
    : { y: 0, h: 1, w: ratio / imageRatio, x: (1 - ratio / imageRatio) / 2 };
}

/** 编辑器从哪张图「飞」出来:预览里那张图在屏幕上的位置、已经加载好的地址和原始宽高 */
export type EditorOrigin = { rect: DOMRect; src: string; width: number; height: number };

/** 从预览里正在显示的 <img> 算出图片真正画在哪(object-fit: contain 时元素比图大) */
export function editorOriginFrom(image: HTMLImageElement | null | undefined): EditorOrigin | undefined {
  if (!image || !image.naturalWidth) return undefined;
  const box = image.getBoundingClientRect();
  let rect = box;
  if (getComputedStyle(image).objectFit === "contain") {
    const scale = Math.min(box.width / image.naturalWidth, box.height / image.naturalHeight);
    const width = image.naturalWidth * scale, height = image.naturalHeight * scale;
    rect = new DOMRect(box.left + (box.width - width) / 2, box.top + (box.height - height) / 2, width, height);
  }
  return { rect, src: image.currentSrc || image.src, width: image.naturalWidth, height: image.naturalHeight };
}

type Motion = { from: DOMRect; turn?: number; fade?: boolean };
const EASE = "cubic-bezier(.16, 1, .3, 1)";
const reducedMotion = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/** 把画布从 from 的位置、大小(转过 turn 度)变到现在的位置 */
function morphFrame(frame: HTMLElement, { from, turn = 0, fade }: Motion, reverse = false) {
  const to = frame.getBoundingClientRect();
  if (!to.width || !to.height) return undefined;
  const dx = from.left + from.width / 2 - (to.left + to.width / 2);
  const dy = from.top + from.height / 2 - (to.top + to.height / 2);
  const turned = Math.abs(turn) % 180 === 90;
  const sx = turned ? from.height / to.width : from.width / to.width;
  const sy = turned ? from.width / to.height : from.height / to.height;
  const start = { transform: `translate(${dx}px, ${dy}px) rotate(${-turn}deg) scale(${sx}, ${sy})`, opacity: fade ? 0.5 : 1 };
  const end = { transform: "none", opacity: 1 };
  return frame.animate(reverse ? [end, start] : [start, end],
    { duration: reverse ? 360 : 560, easing: reverse ? "cubic-bezier(.5, 0, .2, 1)" : EASE, fill: reverse ? "forwards" : "none" });
}

async function editorRequest<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, headers: { ...apiKeyHeaders(), ...init?.headers } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error((data as { error?: string }).error || "请求失败");
  return data as T;
}

/**
 * 图片编辑:裁剪(比例、旋转、翻转、拉直)、调整、涂鸦、马赛克、涂抹、擦除,可撤销 / 重做。
 * 编辑用原图(满分辨率);保存时可以下载、存入素材库,或直接加到输入框当参考图。
 */
export function ImageEditor({ src, name, origin, onClose, onFinished }: {
  src: string;
  name: string;
  /** 从预览里的那张图展开(关闭时收回去);没有时淡入 */
  origin?: EditorOrigin;
  onClose: () => void;
  /** 加到输入框之后:顺手把下面的预览也关掉 */
  onFinished?: () => void;
}) {
  const targets = useContext(ImageEditContext);
  const workRef = useRef<HTMLCanvasElement>(null);
  const previewRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const toolsRef = useRef<HTMLElement>(null);
  // 下一次画布换了位置 / 大小时要播的过渡(进入、裁剪、旋转、撤销)
  const motionRef = useRef<Motion | null>(origin ? { from: origin.rect } : null);
  const baseRef = useRef<HTMLCanvasElement | null>(null);
  const historyRef = useRef<{ list: Snapshot[]; index: number }>({ list: [], index: 0 });
  const strokeRef = useRef<{ id: number; x: number; y: number; source: HTMLCanvasElement | null } | null>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState("");
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [stage, setStage] = useState({ width: 0, height: 0 });
  const [tick, setTick] = useState(0);
  const [cropDragging, setCropDragging] = useState(false);
  const [fileName, setFileName] = useState(() => `${name.replace(/\.[^.]+$/, "") || "图片"}-编辑`);
  const [renaming, setRenaming] = useState(false);
  const [steps, setSteps] = useState({ index: 0, count: 1 });
  const [tool, setTool] = useState<Tool>("crop");
  const [crop, setCrop] = useState<Rect>(FULL);
  const [ratio, setRatio] = useState<number | null>(null);
  const [angle, setAngle] = useState(0);
  const [adjust, setAdjust] = useState<Adjust>(NO_ADJUST);
  const [color, setColor] = useState(COLORS[2]);
  const [brush, setBrush] = useState(24);
  const [menu, setMenu] = useState(false);
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [leaving, setLeaving] = useState(false);

  const edited = steps.index > 0 || crop !== FULL || angle !== 0 || adjust !== NO_ADJUST;

  // ---------- 读原图 ----------
  useEffect(() => {
    let alive = true;
    (async () => {
      const response = await fetch(src);
      if (!response.ok) throw new Error(`读取原图失败（${response.status}）`);
      const bitmap = await createImageBitmap(await response.blob());
      if (!alive) return;
      const work = workRef.current!;
      work.width = bitmap.width;
      work.height = bitmap.height;
      context(work).drawImage(bitmap, 0, 0);
      bitmap.close?.();
      baseRef.current = copyOf(work);
      historyRef.current = { list: [{ work: copyOf(work), base: baseRef.current }], index: 0 };
      setSize({ width: work.width, height: work.height });
      setReady(true);
    })().catch((cause: Error) => { if (alive) setFailed(cause.message || "图片读取失败"); });
    return () => { alive = false; };
  }, [src]);

  // ---------- 图在舞台里按比例放到最大 ----------
  useEffect(() => {
    const element = stageRef.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      const box = entry.contentRect;
      setStage({ width: box.width, height: box.height });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  // 原图还没读完时先按预览里那张的宽高排好,进入动画可以马上开始
  const shown = size.width ? size : origin ? { width: origin.width, height: origin.height } : size;
  const fitScale = shown.width && stage.width ? Math.min((stage.width - 48) / shown.width, (stage.height - 48) / shown.height, 1.5) : 0;
  const fit = { width: Math.max(1, Math.floor(shown.width * fitScale)), height: Math.max(1, Math.floor(shown.height * fitScale)) };

  // 画布换了大小、位置后播过渡(进入时从预览的图展开、裁剪从框的位置放大、旋转转过去)
  useLayoutEffect(() => {
    const motion = motionRef.current, frame = frameRef.current;
    if (!motion || !frame || !fitScale) return;
    motionRef.current = null;
    if (!reducedMotion()) morphFrame(frame, motion);
  }, [fit.width, fit.height, fitScale, tick]);
  const frameRect = () => frameRef.current?.getBoundingClientRect();

  // ---------- 历史 ----------
  const limit = size.width ? Math.min(30, Math.max(4, Math.floor(240e6 / (size.width * size.height)))) : 30;
  const record = useCallback(() => {
    const history = historyRef.current;
    const list = history.list.slice(0, history.index + 1);
    list.push({ work: copyOf(workRef.current!), base: baseRef.current! });
    while (list.length > limit) list.splice(1, 1);
    historyRef.current = { list, index: list.length - 1 };
    setSteps({ index: list.length - 1, count: list.length });
  }, [limit]);

  const restore = (index: number) => {
    const history = historyRef.current;
    const entry = history.list[index];
    if (!entry) return;
    const work = workRef.current!;
    work.width = entry.work.width;
    work.height = entry.work.height;
    context(work).drawImage(entry.work, 0, 0);
    baseRef.current = entry.base;
    history.index = index;
    setSteps({ index, count: history.list.length });
    const from = frameRect();
    if (from) motionRef.current = { from, fade: true };
    setSize({ width: work.width, height: work.height });
    setTick((value) => value + 1);
    setCrop(FULL); setAngle(0); setAdjust(NO_ADJUST);
  };
  const undo = () => restore(historyRef.current.index - 1);
  const redo = () => restore(historyRef.current.index + 1);
  const reset = () => {
    restore(0);
    const history = historyRef.current;
    history.list = history.list.slice(0, 1);
    setSteps({ index: 0, count: 1 });
  };

  /** 换一张新画布(裁剪、旋转、调整之后):擦除以这张为准 */
  const replaceWith = (next: HTMLCanvasElement) => {
    const work = workRef.current!;
    work.width = next.width;
    work.height = next.height;
    context(work).drawImage(next, 0, 0);
    baseRef.current = copyOf(work);
    setSize({ width: work.width, height: work.height });
    setTick((value) => value + 1);
    record();
  };

  // ---------- 裁剪 / 拉直 / 调整:切换工具或保存前先落实 ----------
  const commitCrop = () => {
    if (crop === FULL && angle === 0) return false;
    const work = workRef.current!;
    let source: HTMLCanvasElement = work;
    if (angle !== 0) {
      const scale = straightenScale(work.width, work.height, angle);
      source = canvasOf(work.width, work.height);
      const sourceContext = context(source);
      sourceContext.imageSmoothingQuality = "high";
      sourceContext.translate(work.width / 2, work.height / 2);
      sourceContext.rotate(angle * Math.PI / 180);
      sourceContext.scale(1 / scale, 1 / scale);
      sourceContext.drawImage(work, -work.width / 2, -work.height / 2);
    }
    // 裁好的图从裁剪框的位置放大到舞台中间
    const box = frameRef.current?.querySelector(".image-editor-crop")?.getBoundingClientRect();
    motionRef.current = box ? { from: box } : null;
    const x = Math.round(crop.x * work.width), y = Math.round(crop.y * work.height);
    const out = canvasOf(crop.w * work.width, crop.h * work.height);
    context(out).drawImage(source, x, y, out.width, out.height, 0, 0, out.width, out.height);
    setCrop(FULL); setAngle(0); setRatio(null);
    replaceWith(out);
    return true;
  };
  const commitAdjust = () => {
    if (adjust === NO_ADJUST) return false;
    const work = workRef.current!;
    const workContext = context(work);
    const image = workContext.getImageData(0, 0, work.width, work.height);
    applyAdjust(image.data, adjust);
    const out = canvasOf(work.width, work.height);
    context(out).putImageData(image, 0, 0);
    setAdjust(NO_ADJUST);
    replaceWith(out);
    return true;
  };
  const commitPending = () => { commitCrop(); commitAdjust(); };

  const chooseTool = (next: Tool) => {
    if (next === tool) return;
    commitPending();
    setTool(next);
  };

  const transform = (kind: "left" | "right" | "flipX" | "flipY") => {
    commitPending();
    const work = workRef.current!;
    const turn = kind === "left" || kind === "right";
    const out = canvasOf(turn ? work.height : work.width, turn ? work.width : work.height);
    const outContext = context(out);
    outContext.translate(out.width / 2, out.height / 2);
    if (kind === "left") outContext.rotate(-Math.PI / 2);
    if (kind === "right") outContext.rotate(Math.PI / 2);
    if (kind === "flipX") outContext.scale(-1, 1);
    if (kind === "flipY") outContext.scale(1, -1);
    outContext.drawImage(work, -work.width / 2, -work.height / 2);
    const from = frameRect();
    if (turn && from) motionRef.current = { from, turn: kind === "right" ? 90 : -90 };
    replaceWith(out);
    // 翻转:像翻纸一样转过来
    const frame = frameRef.current;
    if (!turn && frame && !reducedMotion()) {
      frame.animate([{ transform: `perspective(1600px) ${kind === "flipX" ? "rotateY" : "rotateX"}(180deg)` }, { transform: "perspective(1600px)" }],
        { duration: 620, easing: EASE });
    }
  };

  const chooseRatio = (value: number | null) => {
    setRatio(value);
    if (value === null) return;
    const actual = value === -1 ? size.width / size.height : value;
    setCrop(ratioRect(actual, size.width, size.height));
  };

  // ---------- 调整的实时预览(缩小的副本上算,拖滑块不卡) ----------
  useEffect(() => {
    if (tool !== "adjust" || !ready) return;
    const frame = requestAnimationFrame(() => {
      const work = workRef.current!, preview = previewRef.current!;
      const scale = Math.min(1, 1400 / Math.max(work.width, work.height));
      preview.width = Math.max(1, Math.round(work.width * scale));
      preview.height = Math.max(1, Math.round(work.height * scale));
      const previewContext = context(preview);
      previewContext.drawImage(work, 0, 0, preview.width, preview.height);
      if (adjust === NO_ADJUST) return;
      const image = previewContext.getImageData(0, 0, preview.width, preview.height);
      applyAdjust(image.data, adjust);
      previewContext.putImageData(image, 0, 0);
    });
    return () => cancelAnimationFrame(frame);
  }, [adjust, tool, ready, size]);

  // ---------- 画笔类工具 ----------
  const painting = tool === "draw" || tool === "mosaic" || tool === "blur" || tool === "erase";
  const toImage = (event: React.PointerEvent) => {
    const work = workRef.current!;
    const box = work.getBoundingClientRect();
    return { x: (event.clientX - box.left) * work.width / box.width, y: (event.clientY - box.top) * work.height / box.height, unit: work.width / box.width };
  };
  const stamp = (from: { x: number; y: number }, to: { x: number; y: number }, unit: number, source: HTMLCanvasElement | null) => {
    const work = workRef.current!;
    const workContext = context(work);
    const width = brush * unit;
    if (tool === "draw" || !source) {
      workContext.save();
      workContext.strokeStyle = color;
      workContext.lineWidth = width;
      workContext.lineCap = "round";
      workContext.lineJoin = "round";
      workContext.beginPath();
      workContext.moveTo(from.x, from.y);
      workContext.lineTo(to.x + 0.01, to.y);
      workContext.stroke();
      workContext.restore();
      return;
    }
    // 沿着这一段每隔 1/4 笔宽盖一个圆:用「来源图」(马赛克 / 模糊 / 原图)的对应位置填进去
    const radius = width / 2;
    const distance = Math.hypot(to.x - from.x, to.y - from.y);
    const count = Math.max(1, Math.ceil(distance / Math.max(1, radius / 2)));
    workContext.save();
    workContext.beginPath();
    for (let i = 0; i <= count; i += 1) {
      const x = from.x + (to.x - from.x) * i / count, y = from.y + (to.y - from.y) * i / count;
      workContext.moveTo(x + radius, y);
      workContext.arc(x, y, radius, 0, Math.PI * 2);
    }
    workContext.clip();
    const left = Math.max(0, Math.floor(Math.min(from.x, to.x) - radius)), top = Math.max(0, Math.floor(Math.min(from.y, to.y) - radius));
    const right = Math.min(work.width, Math.ceil(Math.max(from.x, to.x) + radius)), bottom = Math.min(work.height, Math.ceil(Math.max(from.y, to.y) + radius));
    if (right > left && bottom > top) workContext.drawImage(source, left, top, right - left, bottom - top, left, top, right - left, bottom - top);
    workContext.restore();
  };
  const onPointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!painting || event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const point = toImage(event);
    const source = tool === "mosaic" ? pixelated(workRef.current!) : tool === "blur" ? blurred(workRef.current!) : tool === "erase" ? baseRef.current : null;
    strokeRef.current = { id: event.pointerId, x: point.x, y: point.y, source };
    stamp(point, point, point.unit, source);
  };
  const onPointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const stroke = strokeRef.current;
    if (!stroke || stroke.id !== event.pointerId) return;
    const point = toImage(event);
    stamp(stroke, point, point.unit, stroke.source);
    stroke.x = point.x; stroke.y = point.y;
  };
  const onPointerUp = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!strokeRef.current || strokeRef.current.id !== event.pointerId) return;
    strokeRef.current = null;
    record();
  };

  // ---------- 裁剪框的拖动 ----------
  const dragCrop = (mode: string) => (event: React.PointerEvent<HTMLElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setCropDragging(true);
    const frame = (event.currentTarget.closest(".image-editor-frame") as HTMLElement).getBoundingClientRect();
    const start = { x: event.clientX, y: event.clientY, rect: crop };
    const fixed = ratio === null ? null : (ratio === -1 ? size.width / size.height : ratio) * size.height / size.width;
    const move = (moveEvent: PointerEvent) => {
      const dx = (moveEvent.clientX - start.x) / frame.width, dy = (moveEvent.clientY - start.y) / frame.height;
      const r = start.rect;
      if (mode === "move") { setCrop(clampRect({ ...r, x: r.x + dx, y: r.y + dy })); return; }
      let { x, y, w, h } = r;
      if (mode.includes("w")) { x = Math.min(r.x + r.w - 0.02, Math.max(0, r.x + dx)); w = r.x + r.w - x; }
      if (mode.includes("e")) w = Math.min(1 - r.x, Math.max(0.02, r.w + dx));
      if (mode.includes("n")) { y = Math.min(r.y + r.h - 0.02, Math.max(0, r.y + dy)); h = r.y + r.h - y; }
      if (mode.includes("s")) h = Math.min(1 - r.y, Math.max(0.02, r.h + dy));
      if (fixed) {
        // 锁定比例:以拖动的那条边为准,另一边跟着变,超出图片就整体缩回来
        if (mode === "n" || mode === "s") w = h * fixed; else h = w / fixed;
        if (x + w > 1) { w = 1 - x; h = w / fixed; }
        if (y + h > 1) { h = 1 - y; w = h * fixed; }
        if (mode.includes("n")) y = r.y + r.h - h;
        if (mode.includes("w")) x = r.x + r.w - w;
      }
      setCrop(clampRect({ x, y, w, h }));
    };
    const up = () => { setCropDragging(false); window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  // ---------- 关闭(有改动时先确认) ----------
  const close = (force = false, back = true) => {
    if (!force && edited && !confirmLeave) { setConfirmLeave(true); return; }
    setLeaving(true);
    const frame = frameRef.current;
    // 没改过就收回到预览那张图上(改过的图和预览不一样,直接淡出)
    const animation = back && !edited && origin && frame && !reducedMotion() ? morphFrame(frame, { from: origin.rect }, true) : undefined;
    if (animation) void animation.finished.then(onClose, onClose);
    else window.setTimeout(onClose, 220);
  };

  // ---------- 保存 ----------
  const output = async () => {
    commitPending();
    const work = workRef.current!;
    const blob = await new Promise<Blob | null>((resolve) => work.toBlob(resolve, "image/png"));
    if (!blob) throw new Error("导出图片失败");
    const stem = fileName.trim().replace(/\.png$/i, "") || name.replace(/\.[^.]+$/, "") || "图片";
    return new File([blob], `${stem}.png`, { type: "image/png" });
  };
  const run = async (label: string, action: (file: File) => Promise<string | void>) => {
    setMenu(false);
    setBusy(label);
    try {
      const message = await action(await output());
      if (message) { setNotice(message); window.setTimeout(() => setNotice(""), 2200); }
    } catch (cause) {
      setNotice((cause as Error).message || "保存失败");
    } finally {
      setBusy("");
    }
  };
  const download = () => run("正在导出", async (file) => {
    const url = URL.createObjectURL(file);
    const link = document.createElement("a");
    link.href = url;
    link.download = file.name;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 4000);
    return "已下载到本地";
  });
  const saveToLibrary = () => run("正在存入素材库", async (file) => {
    await uploadMedia(file, editorRequest);
    targets.saved?.();
    return "已存入素材库";
  });
  const attach = () => run("正在添加", async (file) => {
    targets.attach?.(file);
    close(true, false);
    onFinished?.();
  });

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      // 改名输入框里的按键(回车、Esc、撤销)留给输入框自己;下面的预览在编辑时不听按键
      if ((event.target as HTMLElement | null)?.closest?.("input")) return;
      event.stopPropagation();
      const mod = event.ctrlKey || event.metaKey;
      if (event.key === "Escape") { if (menu) setMenu(false); else close(); }
      else if (mod && event.key.toLowerCase() === "z" && !event.shiftKey) { event.preventDefault(); if (historyRef.current.index > 0) undo(); }
      else if (mod && (event.key.toLowerCase() === "y" || (event.key.toLowerCase() === "z" && event.shiftKey))) {
        event.preventDefault();
        if (historyRef.current.index < historyRef.current.list.length - 1) redo();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  });

  const scale = angle ? 1 / straightenScale(size.width, size.height, angle) : 1;
  useSlidingThumb(toolsRef);
  const commitName = (value: string) => {
    const next = value.trim().replace(/[\\/:*?"<>|]+/g, "").slice(0, 120);
    if (next) setFileName(next.replace(/\.png$/i, ""));
    setRenaming(false);
  };
  const showPreview = tool === "adjust" && ready;

  return createPortal(
    <div className={`image-editor ${leaving ? "is-leaving" : ""}`} role="dialog" aria-modal="true" aria-label="编辑图片"
      onClick={(event) => event.stopPropagation()} onMouseDown={(event) => event.stopPropagation()}
      onPointerDown={(event) => { if (menu && !(event.target as HTMLElement).closest(".image-editor-save")) setMenu(false); }}>
      <header className="image-editor-bar">
        <div className="image-editor-history">
          <button type="button" onClick={undo} disabled={steps.index === 0} title="撤销（Ctrl / ⌘ + Z）" aria-label="撤销"><Undo2 size={16} /></button>
          <button type="button" onClick={redo} disabled={steps.index >= steps.count - 1} title="重做（Ctrl / ⌘ + Shift + Z）" aria-label="重做"><Redo2 size={16} /></button>
          <button type="button" className="text" onClick={reset} disabled={!edited}>还原</button>
          {renaming
            ? <input className="image-editor-rename" autoFocus defaultValue={fileName} maxLength={120} aria-label="文件名"
              onFocus={(event) => event.currentTarget.select()}
              onBlur={(event) => commitName(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") event.currentTarget.blur();
                if (event.key === "Escape") { event.currentTarget.value = fileName; event.currentTarget.blur(); }
              }} />
            : <button type="button" className="image-editor-name" onClick={() => setRenaming(true)}
              title={`保存时的文件名（原图：${name}），点击重命名`}>
              <span>{fileName}.png</span><Pencil size={13} aria-hidden="true" />
            </button>}
        </div>
        <nav className="image-editor-tools" aria-label="编辑工具" ref={toolsRef}>
          <span className="segmented-thumb" aria-hidden="true" />
          {TOOLS.map(({ id, label, icon: Icon, hint }) => (
            <button type="button" key={id} aria-pressed={tool === id} onClick={() => chooseTool(id)} title={hint} disabled={!ready}>
              <Icon size={17} /><span>{label}</span>
            </button>
          ))}
        </nav>
        <div className="image-editor-actions">
          {notice && <span className="image-editor-notice" role="status">{notice}</span>}
          <div className="image-editor-save">
            <button type="button" className="primary" onClick={() => setMenu((open) => !open)} disabled={!ready || Boolean(busy)}
              aria-expanded={menu}>
              {busy ? <><Loader2 size={15} className="spin" />{busy}</> : <>保存<ChevronDown size={15} /></>}
            </button>
            {menu && <div className="image-editor-menu" role="menu">
              {targets.attach && <button type="button" role="menuitem" onClick={attach}>
                <ImagePlus size={15} /><span><b>添加到输入框</b><small>作为参考图，同时存入素材库</small></span></button>}
              <button type="button" role="menuitem" onClick={saveToLibrary}>
                <FolderPlus size={15} /><span><b>存入素材库</b><small>以后在 @ 和资产页里都能用</small></span></button>
              <button type="button" role="menuitem" onClick={download}>
                <Download size={15} /><span><b>下载到本地</b><small>PNG，原图分辨率</small></span></button>
            </div>}
          </div>
          <button type="button" className={confirmLeave ? "danger" : ""} onClick={() => close()}>
            {confirmLeave ? "放弃修改并关闭" : "取消"}
          </button>
        </div>
      </header>

      <div className="image-editor-stage" ref={stageRef}>
        {!ready && !failed && <span className="image-editor-loading"><Loader2 size={22} className="spin" />正在读取原图…</span>}
        {failed && <span className="image-editor-loading">{failed}</span>}
        <div className={`image-editor-frame ${origin ? "" : "no-origin"}`} data-tool={tool} ref={frameRef}
          style={{ width: fit.width, height: fit.height, visibility: ready || origin ? "visible" : "hidden" }}>
          {/* 原图读完之前先垫着预览里那张(已经加载过,马上能显示) */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {!ready && origin && <img className="image-editor-placeholder" src={origin.src} alt="" draggable={false} />}
          <canvas ref={workRef} className="image-editor-canvas"
            style={{ transform: angle ? `rotate(${angle}deg) scale(${scale})` : undefined, visibility: showPreview || !ready ? "hidden" : undefined,
              cursor: painting ? "crosshair" : undefined, ["--brush" as string]: `${brush}px` }}
            onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp} />
          <canvas ref={previewRef} className="image-editor-canvas image-editor-preview" hidden={!showPreview} />
          {tool === "crop" && ready && (
            <div className={`image-editor-crop ${cropDragging ? "is-dragging" : ""}`} style={{
              left: `${crop.x * 100}%`, top: `${crop.y * 100}%`, width: `${crop.w * 100}%`, height: `${crop.h * 100}%`,
            }} onPointerDown={dragCrop("move")}>
              <i className="grid" aria-hidden="true" />
              {["n", "s", "e", "w", "nw", "ne", "sw", "se"].map((edge) => (
                <span key={edge} className="handle" data-edge={edge} onPointerDown={dragCrop(edge)} aria-hidden="true" />
              ))}
            </div>
          )}
        </div>
      </div>

      <footer className="image-editor-options">
        {/* 换工具时这一排重新挂上,里面的控件依次浮上来 */}
        <div className="image-editor-options-row" key={tool}>
        {tool === "crop" && <>
          <div className="group">
            <button type="button" onClick={() => transform("left")} title="向左转 90°" aria-label="向左转"><RotateCcw size={16} /></button>
            <button type="button" onClick={() => transform("right")} title="向右转 90°" aria-label="向右转"><RotateCw size={16} /></button>
            <button type="button" onClick={() => transform("flipX")} title="水平翻转" aria-label="水平翻转"><FlipHorizontal2 size={16} /></button>
            <button type="button" onClick={() => transform("flipY")} title="垂直翻转" aria-label="垂直翻转"><FlipVertical2 size={16} /></button>
          </div>
          <label className="slider">
            <span>拉直 <b>{angle}°</b></span>
            <input type="range" min={-45} max={45} step={1} value={angle} onChange={(event) => setAngle(Number(event.target.value))}
              onDoubleClick={() => setAngle(0)} />
          </label>
          <div className="group chips" role="group" aria-label="裁剪比例">
            {RATIOS.map((item) => <button type="button" key={item.label} aria-pressed={ratio === item.value}
              onClick={() => chooseRatio(item.value)}>{item.label}</button>)}
          </div>
          <button type="button" className="apply" disabled={crop === FULL && angle === 0} onClick={() => commitCrop()}>
            <Check size={15} />应用裁剪
          </button>
        </>}
        {tool === "adjust" && <>
          {([["brightness", "亮度"], ["contrast", "对比度"], ["saturation", "饱和度"], ["warmth", "色温"]] as const).map(([key, label]) => (
            <label className="slider" key={key}>
              <span>{label} <b>{adjust[key] > 0 ? `+${adjust[key]}` : adjust[key]}</b></span>
              <input type="range" min={-100} max={100} step={1} value={adjust[key]}
                onChange={(event) => setAdjust((current) => ({ ...current, [key]: Number(event.target.value) }))}
                onDoubleClick={() => setAdjust((current) => ({ ...current, [key]: 0 }))} />
            </label>
          ))}
          <button type="button" className="apply" disabled={adjust === NO_ADJUST} onClick={() => commitAdjust()}>
            <Check size={15} />应用调整
          </button>
        </>}
        {painting && <>
          {tool === "draw" && <div className="group swatches" role="group" aria-label="画笔颜色">
            {COLORS.map((item) => <button type="button" key={item} aria-pressed={color === item} aria-label={item}
              style={{ ["--swatch" as string]: item }} onClick={() => setColor(item)} />)}
            <label className="swatch-custom" title="自选颜色">
              <input type="color" value={color} onChange={(event) => setColor(event.target.value)} aria-label="自选颜色" />
            </label>
          </div>}
          <label className="slider">
            <span>笔刷大小 <b>{brush}</b></span>
            <input type="range" min={4} max={140} step={1} value={brush} onChange={(event) => setBrush(Number(event.target.value))} />
          </label>
          <span className="brush-preview" style={{ width: Math.min(brush, 56), height: Math.min(brush, 56), background: tool === "draw" ? color : undefined }}
            data-tool={tool} aria-hidden="true" />
          <span className="hint">{TOOLS.find((item) => item.id === tool)?.hint}</span>
        </>}
        </div>
      </footer>
    </div>,
    document.body,
  );
}
