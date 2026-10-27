"use client";

import { useEffect } from "react";
import { createPortal } from "react-dom";
import { ChevronLeft, ChevronRight, Download, Music, X } from "lucide-react";
import { ImageZoom } from "@/components/image-zoom";
import { ProgressVideo } from "@/components/load-progress";
import { mediaUrl, thumbUrl, viewUrl } from "@/lib/media-url";
import type { MediaRef } from "@/lib/types";

export interface PreviewItem {
  kind: MediaRef["kind"];
  name: string;
  /** 显示用的地址:已上传的走 /api/media,还在上传的用本地预览地址 */
  src: string;
  /** 下载地址;没有时不显示下载按钮 */
  download?: string;
  /** 左下角的说明,例如「图1 · cat.png」 */
  caption?: string;
  /** 原图加载出来之前先垫着的缩略图(卡片里已经加载过,有缓存) */
  preview?: string;
}

export const mediaPreviewItem = (media: MediaRef, caption?: string): PreviewItem => ({
  kind: media.kind,
  name: media.name,
  src: media.kind === "image" ? viewUrl(media.path) : mediaUrl(media.path),
  download: `${mediaUrl(media.path)}?download=${encodeURIComponent(media.name)}`,
  caption,
  preview: media.kind === "image" ? thumbUrl(media.path, 480) : undefined,
});

/**
 * 放大查看参考素材(图片、视频、音频),样式与生成结果的放大预览一致。
 * 挂在 body 上,不受卡片动画和输入框布局的影响;Esc 关闭,左右方向键切换。
 */
export function MediaPreview({ items, index, onIndex, onClose }: {
  items: PreviewItem[];
  index: number;
  onIndex: (index: number) => void;
  onClose: () => void;
}) {
  const current = items[index];
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      // 可能叠在生成结果的放大预览上面:这几个键只给最上层,不让下面的跟着关闭、翻页
      if (["Escape", "ArrowLeft", "ArrowRight"].includes(event.key)) event.stopPropagation();
      if (event.key === "Escape") onClose();
      if (event.key === "ArrowLeft" && index > 0) onIndex(index - 1);
      if (event.key === "ArrowRight" && index < items.length - 1) onIndex(index + 1);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [index, items.length, onClose, onIndex]);

  if (!current || typeof document === "undefined") return null;
  return createPortal(
    <div className="video-viewer media-preview" role="dialog" aria-modal="true" aria-label="素材预览"
      onClick={(event) => { event.stopPropagation(); onClose(); }}
      onMouseDown={(event) => event.stopPropagation()}>
      <div className="video-viewer-body" onClick={(event) => event.stopPropagation()}>
        {current.kind === "image" && <ImageZoom key={current.src} src={current.src} alt={current.name} preview={current.preview} />}
        {current.kind === "video" && <ProgressVideo key={current.src} src={current.src} controls autoPlay playsInline />}
        {current.kind === "audio" && (
          <div className="media-preview-audio" key={current.src}>
            <Music size={34} />
            <audio src={current.src} controls autoPlay />
          </div>
        )}
        <div className="video-viewer-bar">
          <p title={current.caption || current.name}>{current.caption || current.name}</p>
          {items.length > 1 && <span>{index + 1} / {items.length}</span>}
          {current.download && <a href={current.download} download={current.name}><Download size={15} />下载</a>}
        </div>
      </div>
      {index > 0 && <button type="button" className="video-viewer-nav prev" aria-label="上一个"
        onClick={(event) => { event.stopPropagation(); onIndex(index - 1); }}><ChevronLeft size={22} /></button>}
      {index < items.length - 1 && <button type="button" className="video-viewer-nav next" aria-label="下一个"
        onClick={(event) => { event.stopPropagation(); onIndex(index + 1); }}><ChevronRight size={22} /></button>}
      <button type="button" className="video-viewer-close" onClick={(event) => { event.stopPropagation(); onClose(); }} aria-label="关闭">
        <X size={20} />
      </button>
    </div>,
    document.body,
  );
}
