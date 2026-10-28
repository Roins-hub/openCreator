"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  Clapperboard, Copy, Download, FolderOpen, ImagePlus, Info,
  MoreHorizontal, Pencil, RefreshCw, Star, Trash2,
} from "lucide-react";
import type { MediaRef, Message } from "@/lib/types";
import { fitImageOptions, imageOptionsSummary } from "@/lib/image-models";
import { findReference, referenceLabels, splitPromptReferences } from "@/lib/prompt-references";
import { unfinishedTaskIds } from "@/lib/generation-stop";
import { MediaThumb, ThumbImage } from "@/components/media-thumb";
import { MediaPreview, mediaPreviewItem } from "@/components/media-preview";
import { formatTime, StatusBadge, TaskTimes } from "@/components/video-task-card";
import { ResultViewer } from "@/components/result-viewer";
import { formatBytes } from "@/components/generation-info";

type Props = {
  prompt: string;
  references: MediaRef[];
  message: Message;
  fallbackModelName?: string;
  favorite: boolean;
  onReedit: () => void;
  onRegenerate: () => void;
  onToggleFavorite: () => void;
  onDelete: () => void;
  /** 把这张图带到视频模型,作为参考图 / 首帧 */
  onMakeVideo: (image: MediaRef) => void;
  /** 留在生图模型,把这张图作为参考图继续修改 */
  onUseAsReference: (image: MediaRef) => void;
  /** 旧记录的文件大小(从资产列表查到的);新记录的大小记在 media.size 上 */
  sizes?: Record<string, number>;
  /** 按住卡片上的素材(参考图、生成的图)开始拖:拖到输入框里作为参考素材 */
  onDragMedia?: (event: React.PointerEvent<HTMLElement>, media: MediaRef) => void;
};

const downloadUrl = (image: MediaRef) => `/api/media/${image.path}?download=${encodeURIComponent(image.name)}`;

/** 生图记录:提示词、参考图、生成的图片网格;每张图可以下载、做成视频或作为参考图继续改。 */
export function ImageTaskCard({
  prompt, references, message, fallbackModelName, favorite,
  onReedit, onRegenerate, onToggleFavorite, onDelete, onMakeVideo, onUseAsReference, sizes, onDragMedia,
}: Props) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [copied, setCopied] = useState("");
  const [viewer, setViewer] = useState<number | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const images = (message.media || []).filter((item) => item.kind === "image");
  const sizeOf = (media: MediaRef) => media.size ?? sizes?.[media.path];
  const totalSize = images.reduce((sum, item) => sum + (sizeOf(item) || 0), 0);
  const options = message.generation?.imageOptions ? fitImageOptions(message.generation.imageOptions) : undefined;
  const pending = message.status === "processing" ? unfinishedTaskIds(message).length : 0;
  const labels = referenceLabels(references);
  // 点参考图放大查看
  const [refPreview, setRefPreview] = useState<number | null>(null);
  const shape = (options?.ratio || "1:1").replace(":", " / ");

  useEffect(() => {
    if (!menuOpen) return;
    const close = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) {
        setMenuOpen(false);
        setConfirmDelete(false);
      }
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [menuOpen]);

  const copy = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(label);
      window.setTimeout(() => setCopied(""), 1400);
    } catch { setCopied("复制失败"); }
    setMenuOpen(false);
  };

  const downloadAll = () => images.forEach((image, index) => window.setTimeout(() => {
    const link = document.createElement("a");
    link.href = downloadUrl(image);
    link.download = image.name;
    link.click();
  }, index * 400));

  const meta = [message.generation?.modelName || fallbackModelName, ...(options ? imageOptionsSummary(options) : [])]
    .filter(Boolean) as string[];

  return (
    <article id={`message-${message.id}`} className={`task-card image-task ${message.status}`}>
      <div className="task-main">
        <header className="task-head">
          <StatusBadge status={message.status} />
          <span className="task-id">{images.length ? `${images.length} 张图片` : "图片生成"}</span>
          {copied && <span className="task-toast">{copied}</span>}
          <div className="task-actions">
            <button type="button" onClick={onReedit} title="重新编辑" aria-label="重新编辑"><Pencil size={15} /></button>
            <button type="button" onClick={onRegenerate} title="重新生成（同样的提示词和参数再生成一次，会再次计费）"
              aria-label="重新生成"><RefreshCw size={15} /></button>
            <button type="button" onClick={downloadAll} disabled={!images.length}
              title={images.length > 1 ? "下载全部图片" : "下载图片"} aria-label="下载图片"><Download size={15} /></button>
            <button type="button" className={favorite ? "is-on" : ""} onClick={onToggleFavorite}
              disabled={!images.length}
              title={!images.length ? "图片生成后才能收藏" : favorite ? "取消收藏（资产库「收藏」中可见）" : "收藏到资产库"}
              aria-label="收藏" aria-pressed={favorite}>
              <Star size={15} fill={favorite ? "currentColor" : "none"} />
            </button>
            <div className="task-menu-wrap" ref={menuRef}>
              <button type="button" onClick={() => { setMenuOpen((open) => !open); setConfirmDelete(false); }}
                title="更多" aria-label="更多操作" aria-expanded={menuOpen}><MoreHorizontal size={16} /></button>
              {menuOpen && (
                <div className="task-menu" role="menu">
                  <button type="button" role="menuitem" onClick={() => void copy(prompt, "已复制提示词")}><Copy size={14} />复制提示词</button>
                  <Link role="menuitem" href="/assets" onClick={() => setMenuOpen(false)}><FolderOpen size={14} />在资产库查看</Link>
                  <hr />
                  <button type="button" role="menuitem" className="danger"
                    title={message.status === "processing" ? "只删除记录，正在生成的图片仍会计费" : undefined}
                    onClick={() => {
                      if (!confirmDelete) { setConfirmDelete(true); return; }
                      setMenuOpen(false);
                      onDelete();
                    }}>
                    <Trash2 size={14} />{confirmDelete ? "再次点击确认删除" : "删除记录"}
                  </button>
                </div>
              )}
            </div>
          </div>
        </header>

        <p className="task-prompt">
          {prompt ? splitPromptReferences(prompt).map((segment, index) => {
            if (segment.kind === "text") return <span key={index}>{segment.text}</span>;
            const position = findReference(references, segment.mediaKind, segment.index);
            const ref = references[position];
            return ref ? (
              <button type="button" className="task-ref" key={index} title={`放大查看 ${ref.name}（可拖到输入框）`}
                onPointerDown={(event) => onDragMedia?.(event, ref)}
                onClick={() => setRefPreview(position)}><MediaThumb media={ref} />{labels[position]}</button>
            ) : <span key={index}>[图{segment.index + 1}]</span>;
          }) : <span className="task-prompt-empty">（无提示词）</span>}
        </p>

        {references.length > 0 && (
          <div className="task-refs" aria-label="参考图">
            {references.map((ref, index) => (
              <button type="button" className="task-ref-thumb" key={`${ref.path}-${index}`}
                title={`放大查看 ${labels[index]} · ${ref.name}（可拖到输入框）`} onClick={() => setRefPreview(index)}
                onPointerDown={(event) => onDragMedia?.(event, ref)}>
                <MediaThumb media={ref} alt={ref.name} /><i>{labels[index]}</i>
              </button>
            ))}
          </div>
        )}
        {refPreview !== null && (
          <MediaPreview items={references.map((ref, index) => mediaPreviewItem(ref, `${labels[index]} · ${ref.name}`))}
            index={refPreview} onIndex={setRefPreview} onClose={() => setRefPreview(null)} />
        )}

        {(images.length > 0 || pending > 0) && (
          <div className="image-results" style={{ "--shape": shape } as React.CSSProperties}>
            {images.map((image, index) => (
              <figure className="image-result" key={image.path}>
                <button type="button" className="image-result-open" onClick={() => setViewer(index)} aria-label={`查看第 ${index + 1} 张`}
                  onPointerDown={(event) => onDragMedia?.(event, image)}>
                  <ThumbImage path={image.path} width={1080} alt={image.name} />
                </button>
                <figcaption className="image-result-actions">
                  <button type="button" onClick={() => onMakeVideo(image)} title="用这张图生成视频"><Clapperboard size={13} /><span>做成视频</span></button>
                  <button type="button" onClick={() => onUseAsReference(image)} title="作为参考图继续修改"><ImagePlus size={13} /><span>作参考图</span></button>
                  <a href={downloadUrl(image)} download={image.name} title="下载" aria-label="下载"><Download size={13} /></a>
                </figcaption>
              </figure>
            ))}
            {Array.from({ length: pending }, (_, index) => (
              <div className="image-result is-pending" key={`pending-${index}`} aria-label="生成中">
                <span className="shimmer" />
              </div>
            ))}
          </div>
        )}

        <footer className="task-foot">
          {message.status === "failed" && <span className="task-error">{message.error || "图片生成失败"}</span>}
          {message.status === "complete" && message.error && <span className="task-error">部分失败：{message.error}</span>}
          <TaskTimes message={message} durationTitle="从提交到出图的用时" />
          {totalSize > 0 && <span className="task-note task-size" title={images.length > 1 ? `${images.length} 张图片合计` : "图片文件大小"}>
            大小 {formatBytes(totalSize)}</span>}
          <span className="task-meta">
            {meta.join(" | ")}
            <span className="task-info" tabIndex={0} aria-label="任务详情">
              <Info size={13} />
              <span className="task-tooltip" role="tooltip">
                <b>创建时间</b>{formatTime(message.createdAt)}
                {message.generation && <><b>供应商</b>{message.generation.providerName}</>}
                {message.generation && <><b>模型 ID</b>{message.generation.modelId}</>}
              </span>
            </span>
          </span>
        </footer>
      </div>

      {viewer !== null && images[viewer] && (
        <ResultViewer items={images} index={viewer} prompt={prompt} message={message} references={references}
          fallbackModelName={fallbackModelName} sizeOf={sizeOf}
          onIndex={setViewer} onClose={() => setViewer(null)} />
      )}
    </article>
  );
}
