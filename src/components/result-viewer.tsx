"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronLeft, ChevronRight, Download, Info, SquarePen, X } from "lucide-react";
import { ImageEditor, type EditorOrigin } from "@/components/image-editor";
import { FavoriteButton } from "@/components/favorite-context";
import { viewerImageOrigin } from "@/components/media-preview";
import type { MediaRef, Message } from "@/lib/types";
import { mediaDownloadUrl } from "@/lib/download-files";
import { GenerationInfo } from "@/components/generation-info";
import { ImageZoom } from "@/components/image-zoom";
import { ProgressVideo } from "@/components/load-progress";
import { mediaUrl, opensOriginal, thumbUrl, viewUrl } from "@/lib/media-url";

const INFO_KEY = "mote.viewerInfo";

function readInfoOpen() {
  try { return window.localStorage.getItem(INFO_KEY) !== "0"; } catch { return true; }
}

/**
 * 生成结果(视频 / 图片)的放大预览:左边看图或播放,右边是「生成信息」,可收起(记住选择)。
 * 挂到 body 上:放在卡片里时,卡片的动画 / 变换会让 position: fixed 不再相对整个窗口。
 */
export function ResultViewer({
  items, index, onIndex, onClose, message, prompt, references, fallbackModelName, sizeOf,
}: {
  items: MediaRef[];
  index: number;
  onIndex: (index: number) => void;
  onClose: () => void;
  message: Message;
  prompt: string;
  references: MediaRef[];
  fallbackModelName?: string;
  sizeOf: (media: MediaRef) => number | undefined;
}) {
  const current = items[index];
  const [infoOpen, setInfoOpen] = useState(readInfoOpen);
  const [editing, setEditing] = useState<{ origin?: EditorOrigin } | null>(null);
  const toggleInfo = (open: boolean) => {
    setInfoOpen(open);
    try { window.localStorage.setItem(INFO_KEY, open ? "1" : "0"); } catch { /* 只影响下次是否默认展开 */ }
  };

  useEffect(() => {
    if (editing) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      if (event.key === "ArrowLeft" && index > 0) onIndex(index - 1);
      if (event.key === "ArrowRight" && index < items.length - 1) onIndex(index + 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [index, items.length, onClose, onIndex, editing]);

  if (!current) return null;
  const isVideo = current.kind === "video";
  return createPortal(
    <div className="video-viewer" role="dialog" aria-modal="true" aria-label={isVideo ? "视频预览" : "图片预览"} onClick={onClose}>
      <div className={`video-viewer-body ${infoOpen ? "has-info" : ""}`} onClick={(event) => event.stopPropagation()}>
        <div className="viewer-media">
          {isVideo
            ? <ProgressVideo key={current.path} src={mediaUrl(current.path)} poster={thumbUrl(current.path, 480)} controls autoPlay playsInline />
            : opensOriginal(sizeOf(current))
              ? <ImageZoom key={current.path} src={mediaUrl(current.path)} alt={current.name} preview={thumbUrl(current.path, 1080)} />
              : <ImageZoom key={current.path} src={viewUrl(current.path)} alt={current.name} preview={thumbUrl(current.path, 1080)}
                original={mediaUrl(current.path)} />}
          <div className="video-viewer-bar">
            <p title={prompt}>{prompt || current.name}</p>
            {items.length > 1 && <span>{index + 1} / {items.length}</span>}
            {!infoOpen && <button type="button" className="viewer-info-toggle" onClick={() => toggleInfo(true)}>
              <Info size={15} />生成信息
            </button>}
            <FavoriteButton path={current.path} />
            {!isVideo && <button type="button" className="viewer-edit" onClick={(event) => setEditing({ origin: viewerImageOrigin(event.currentTarget) })}
              title="裁剪、调整、涂鸦、马赛克、涂抹、擦除"><SquarePen size={15} />编辑</button>}
            <a href={mediaDownloadUrl(current)} download={current.name}><Download size={15} />下载</a>
          </div>
        </div>
        {infoOpen && <GenerationInfo message={message} prompt={prompt} references={references} media={current}
          size={sizeOf(current)} sizeOf={sizeOf} fallbackModelName={fallbackModelName} onClose={() => toggleInfo(false)} />}
      </div>
      {index > 0 && <button type="button" className="video-viewer-nav prev" aria-label={isVideo ? "上一个" : "上一张"}
        onClick={(event) => { event.stopPropagation(); onIndex(index - 1); }}><ChevronLeft size={22} /></button>}
      {index < items.length - 1 && <button type="button" className="video-viewer-nav next" aria-label={isVideo ? "下一个" : "下一张"}
        onClick={(event) => { event.stopPropagation(); onIndex(index + 1); }}><ChevronRight size={22} /></button>}
      <button type="button" className="video-viewer-close" onClick={onClose} aria-label="关闭"><X size={20} /></button>
      {editing && <ImageEditor src={mediaUrl(current.path)} name={current.name} origin={editing.origin} onClose={() => setEditing(null)} onFinished={onClose} />}
    </div>,
    document.body,
  );
}
