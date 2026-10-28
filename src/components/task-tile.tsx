"use client";

import { useEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { AlertCircle, Loader2, PauseCircle, Play, Star, X } from "lucide-react";
import type { MediaRef, Message } from "@/lib/types";
import { ThumbImage } from "@/components/media-thumb";

const COVER_MAX = 4;

function clock(iso: string) {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false });
}

/**
 * 网格布局里的一条生成记录:只放生成结果(最多拼 4 张),下面一行提示词、一行模型和时间。
 * 点开看详情(提示词、参考素材、参数和各项操作);按住结果拖到输入框可当参考素材。
 */
export function TaskTile({ message, kind, prompt, modelName, favorite, onOpen, onDragMedia }: {
  message: Message;
  kind: "image" | "video";
  prompt: string;
  modelName?: string;
  favorite: boolean;
  onOpen: () => void;
  onDragMedia?: (event: React.PointerEvent<HTMLElement>, media: MediaRef) => void;
}) {
  const results = (message.media || []).filter((item) => item.kind === kind);
  const shown = results.slice(0, COVER_MAX);
  const duration = message.generation?.videoOptions?.duration;
  const amount = kind === "video" ? (duration ? `${duration} 秒` : "视频") : results.length ? `${results.length} 张` : "";
  const meta = [modelName || message.generation?.modelName, amount, clock(message.createdAt)].filter(Boolean);

  let cover: ReactNode;
  if (shown.length) {
    cover = shown.map((item, index) => (
      <span className="task-tile-shot" key={item.path} onPointerDown={(event) => onDragMedia?.(event, item)}>
        <ThumbImage path={item.path} width={shown.length === 1 ? 1080 : 480} alt={`${index + 1}`} />
        {index === shown.length - 1 && results.length > shown.length && <b className="task-tile-more">+{results.length - shown.length}</b>}
      </span>
    ));
  } else if (message.status === "processing") {
    cover = <span className="task-tile-state"><Loader2 size={20} className="spin" />{kind === "video" ? "视频生成中" : "图片生成中"}</span>;
  } else if (message.status === "stopped") {
    cover = <span className="task-tile-state"><PauseCircle size={20} />已停止，没有生成结果</span>;
  } else {
    cover = <span className="task-tile-state is-failed"><AlertCircle size={20} />
      <span>{message.error || (kind === "video" ? "视频生成失败" : "图片生成失败")}</span></span>;
  }

  return (
    <article id={`message-${message.id}`} className="task-tile" data-status={message.status}>
      <button type="button" className="task-tile-cover" data-count={shown.length} onClick={onOpen}
        aria-label="查看详情" title="查看详情（按住结果可拖到输入框）">
        {cover}
        {kind === "video" && shown.length > 0 && <span className="task-tile-play" aria-hidden="true"><Play size={16} fill="currentColor" /></span>}
        {favorite && <span className="task-tile-fav" aria-label="已收藏"><Star size={12} fill="currentColor" /></span>}
      </button>
      <button type="button" className="task-tile-info" onClick={onOpen}>
        <span className="task-tile-prompt">{prompt || "（无提示词）"}</span>
        <span className="task-tile-meta">
          <span>{meta.join(" · ")}</span>
          {message.status === "failed" && <span className="task-tile-status failed">失败</span>}
          {message.status === "processing" && <span className="task-tile-status running">生成中</span>}
          {message.status === "complete" && message.error && <span className="task-tile-status failed">部分失败</span>}
        </span>
      </button>
    </article>
  );
}

/** 网格里点开的生成详情:里面放和列表里一样的生成卡片(提示词、参考素材、结果、操作都在) */
export function TaskDetail({ message, onClose, children }: { message: Message; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      // 详情里又打开了大图 / 参考图预览时,Esc 先只关那一层
      if (event.key === "Escape" && !document.querySelector(".video-viewer, .media-preview")) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const when = new Date(message.createdAt);
  return createPortal(
    <div className="task-detail" role="dialog" aria-modal="true" aria-label="生成详情"
      onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="task-detail-sheet">
        <header>
          <h2>生成详情</h2>
          {!Number.isNaN(when.getTime()) && <span>{when.toLocaleString("zh-CN", { hour12: false })}</span>}
          <button type="button" onClick={onClose} aria-label="关闭"><X size={18} /></button>
        </header>
        <div className="task-detail-body">{children}</div>
      </div>
    </div>,
    document.body,
  );
}
