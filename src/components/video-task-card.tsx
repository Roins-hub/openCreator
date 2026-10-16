"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  AlertCircle, CheckCircle2, ChevronLeft, ChevronRight, Copy, Download, Info, Loader2,
  MoreHorizontal, PauseCircle, Pencil, Play, RefreshCw, Star, Trash2, X, FolderOpen,
} from "lucide-react";
import type { MediaRef, Message, VideoOptions } from "@/lib/types";
import { findReference, referenceLabels, splitPromptReferences } from "@/lib/prompt-references";
import { MediaThumb } from "@/components/media-thumb";

const modeLabels: Record<VideoOptions["referenceMode"], string> = {
  text: "文生视频", first: "首帧", first_last: "首尾帧", references: "参考生成",
};

type Props = {
  prompt: string;
  references: MediaRef[];
  message: Message;
  /** 旧记录没有生成参数快照时,用当前模型名兜底展示。 */
  fallbackModelName?: string;
  favorite: boolean;
  onReedit: () => void;
  onRegenerate: () => void;
  onToggleFavorite: () => void;
  onDelete: () => void;
};

function formatElapsed(ms: number) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const minutes = String(Math.floor(total / 60)).padStart(2, "0");
  return `${minutes}:${String(total % 60).padStart(2, "0")}`;
}

/** 生成用时:45秒 / 12分34秒 / 1小时5分 */
export function formatDuration(ms: number) {
  const total = Math.max(0, Math.round(ms / 1000));
  if (total < 60) return `${total}秒`;
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  if (hours) return `${hours}小时${minutes ? `${minutes}分` : ""}`;
  return `${minutes}分${total % 60 ? `${total % 60}秒` : ""}`;
}

const pad = (value: number) => String(value).padStart(2, "0");

/** 生成日期:今年的省略年份,如「10月14日 21:53」;seconds 时带上秒 */
export function formatDate(iso: string, now = new Date(), seconds = false) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const time = `${pad(date.getHours())}:${pad(date.getMinutes())}${seconds ? `:${pad(date.getSeconds())}` : ""}`;
  const day = `${date.getMonth() + 1}月${date.getDate()}日`;
  return date.getFullYear() === now.getFullYear() ? `${day} ${time}` : `${date.getFullYear()}年${day} ${time}`;
}

/** 开始/结束时间:结束和开始在同一天时只显示时刻 */
export function taskTimes(createdAt: string, elapsedMs?: number, now = new Date()) {
  const start = formatDate(createdAt, now, true);
  if (!start || elapsedMs === undefined) return { start };
  const endDate = new Date(new Date(createdAt).getTime() + elapsedMs);
  const sameDay = endDate.toDateString() === new Date(createdAt).toDateString();
  const end = sameDay
    ? `${pad(endDate.getHours())}:${pad(endDate.getMinutes())}:${pad(endDate.getSeconds())}`
    : formatDate(endDate.toISOString(), now, true);
  return { start, end };
}

const fullTime = (date: Date) => date.toLocaleString("zh-CN", { hour12: false });

/** 任务卡片底部的开始时间、结束时间和总时长;生成中显示已等待 */
export function TaskTimes({ message, durationTitle }: { message: Message; durationTitle: string }) {
  const finished = message.status === "complete" || message.status === "failed";
  const { start, end } = taskTimes(message.createdAt, finished ? message.elapsedMs : undefined);
  if (!start) return null;
  const startDate = new Date(message.createdAt);
  return (
    <span className="task-times">
      {message.status === "processing" && <span className="task-note">已等待 <Elapsed since={message.createdAt} /></span>}
      <span className="task-note">开始 <time dateTime={message.createdAt} title={fullTime(startDate)}>{start}</time></span>
      {end && message.elapsedMs !== undefined && <>
        <span className="task-note">结束 <time dateTime={new Date(startDate.getTime() + message.elapsedMs).toISOString()}
          title={fullTime(new Date(startDate.getTime() + message.elapsedMs))}>{end}</time></span>
        <span className="task-note task-elapsed" title={durationTitle}>总时长 {formatDuration(message.elapsedMs)}</span>
      </>}
    </span>
  );
}

export function formatTime(iso: string) {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "" :
    date.toLocaleString("zh-CN", { hour12: false, month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

export function Elapsed({ since }: { since: string }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  return <>{formatElapsed(now - new Date(since).getTime())}</>;
}

export function StatusBadge({ status }: { status: Message["status"] }) {
  if (status === "complete") return <span className="task-badge ok"><CheckCircle2 size={13} />已完成</span>;
  if (status === "processing") return <span className="task-badge running"><Loader2 size={13} className="spin" />生成中</span>;
  if (status === "stopped") return <span className="task-badge muted"><PauseCircle size={13} />已停止</span>;
  return <span className="task-badge failed"><AlertCircle size={13} />已失败</span>;
}

export function VideoTaskCard({
  prompt, references, message, fallbackModelName, favorite, onReedit, onRegenerate, onToggleFavorite, onDelete,
}: Props) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [copied, setCopied] = useState("");
  const [viewer, setViewer] = useState<number | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const videos = (message.media || []).filter((item) => item.kind === "video");
  const options = message.generation?.videoOptions;
  const taskId = message.taskIds?.[0] || message.taskId;
  const labels = referenceLabels(references);
  const shortTaskId = taskId ? (taskId.length > 22 ? `${taskId.slice(0, 10)}…${taskId.slice(-8)}` : taskId) : "";

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

  const meta = [
    message.generation?.modelName || fallbackModelName,
    options && `${options.duration}s`,
    options && options.resolution.toUpperCase(),
    options && (options.ratio === "adaptive" ? "智能比例" : options.ratio),
    options && modeLabels[options.referenceMode],
    options && options.count > 1 && `${options.count} 条`,
  ].filter(Boolean) as string[];

  return (
    <article id={`message-${message.id}`} className={`task-card ${message.status}`}>
      <div className="task-main">
        <header className="task-head">
          <StatusBadge status={message.status} />
          <span className="task-id" title={taskId}>{shortTaskId || "No API Task ID"}</span>
          {copied && <span className="task-toast">{copied}</span>}
          <div className="task-actions">
            <button type="button" onClick={onReedit} title="重新编辑" aria-label="重新编辑"><Pencil size={15} /></button>
            {videos[0]
              ? <a href={`/api/media/${videos[0].path}?download=${encodeURIComponent(videos[0].name)}`} download={videos[0].name} title="下载视频" aria-label="下载视频"><Download size={15} /></a>
              : <button type="button" disabled title="暂无可下载的视频" aria-label="下载视频"><Download size={15} /></button>}
            <button type="button" className={favorite ? "is-on" : ""} onClick={onToggleFavorite}
              disabled={!videos.length}
              title={!videos.length ? "视频生成后才能收藏" : favorite ? "取消收藏（资产库「收藏」中可见）" : "收藏到资产库"}
              aria-label="收藏" aria-pressed={favorite}>
              <Star size={15} fill={favorite ? "currentColor" : "none"} />
            </button>
            <div className="task-menu-wrap" ref={menuRef}>
              <button type="button" onClick={() => { setMenuOpen((open) => !open); setConfirmDelete(false); }}
                title="更多" aria-label="更多操作" aria-expanded={menuOpen}><MoreHorizontal size={16} /></button>
              {menuOpen && (
                <div className="task-menu" role="menu">
                  <button type="button" role="menuitem" onClick={() => void copy(prompt, "已复制提示词")}><Copy size={14} />复制提示词</button>
                  {taskId && <button type="button" role="menuitem" onClick={() => void copy(taskId, "已复制任务 ID")}><Copy size={14} />复制任务 ID</button>}
                  <button type="button" role="menuitem" onClick={() => { setMenuOpen(false); onRegenerate(); }}>
                    <RefreshCw size={14} />重新生成</button>
                  <Link role="menuitem" href="/assets" onClick={() => setMenuOpen(false)}><FolderOpen size={14} />在资产库查看</Link>
                  <hr />
                  <button type="button" role="menuitem" className="danger"
                    title={message.status === "processing" ? "只删除记录，云端任务仍会继续生成并计费" : undefined}
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
              <span className="task-ref" key={index} title={ref.name}>
                <MediaThumb media={ref} />{labels[position]}
              </span>
            ) : <span key={index}>[{segment.mediaKind === "image" ? "图" : segment.mediaKind === "video" ? "视频" : "音频"}{segment.index + 1}]</span>;
          }) : <span className="task-prompt-empty">（无提示词）</span>}
        </p>

        {references.length > 0 && (
          <div className="task-refs" aria-label="参考素材">
            {references.map((ref, index) => (
              <span className="task-ref-thumb" key={`${ref.path}-${index}`} title={`${labels[index]} · ${ref.name}`}>
                <MediaThumb media={ref} alt={ref.name} />
                <i>{labels[index]}</i>
              </span>
            ))}
          </div>
        )}

        <footer className="task-foot">
          {message.status === "failed" && <span className="task-error">{message.error || "视频生成失败"}</span>}
          {message.status === "stopped" && <span className="task-note">
            {message.taskIds?.length || message.taskId ? "正在重新获取云端结果…" : message.error || "已停止"}</span>}
          <TaskTimes message={message} durationTitle="中转站从受理任务到出结果的用时" />
          <span className="task-meta">
            {meta.join(" | ")}
            <span className="task-info" tabIndex={0} aria-label="任务详情">
              <Info size={13} />
              <span className="task-tooltip" role="tooltip">
                <b>创建时间</b>{formatTime(message.createdAt)}
                {message.generation && <><b>供应商</b>{message.generation.providerName}</>}
                {message.generation && <><b>模型 ID</b>{message.generation.modelId}</>}
                {taskId && <><b>任务 ID</b>{message.taskIds?.join("\n") || taskId}</>}
              </span>
            </span>
          </span>
        </footer>
      </div>

      <div className="task-preview">
        {videos.length ? (
          <>
            <button type="button" className="task-preview-video" onClick={() => setViewer(0)} aria-label="播放视频">
              <video src={`/api/media/${videos[0].path}`} muted loop playsInline preload="metadata"
                onMouseEnter={(event) => { void event.currentTarget.play().catch(() => undefined); }}
                onMouseLeave={(event) => { event.currentTarget.pause(); event.currentTarget.currentTime = 0; }} />
              <span className="task-play"><Play size={18} fill="currentColor" /></span>
              {options && <span className="task-duration">{options.duration}s</span>}
            </button>
            {videos.length > 1 && <span className="task-more-count">共 {videos.length} 条</span>}
          </>
        ) : message.status === "processing" ? (
          <div className="task-preview-empty running"><span className="shimmer" /><Loader2 size={20} className="spin" /></div>
        ) : (
          <div className="task-preview-empty"><Play size={20} /></div>
        )}
      </div>

      {viewer !== null && videos[viewer] && (
        <VideoViewer videos={videos} index={viewer} prompt={prompt}
          onIndex={setViewer} onClose={() => setViewer(null)} />
      )}
    </article>
  );
}

function VideoViewer({ videos, index, prompt, onIndex, onClose }: {
  videos: MediaRef[]; index: number; prompt: string;
  onIndex: (index: number) => void; onClose: () => void;
}) {
  const current = videos[index];
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      if (event.key === "ArrowLeft" && index > 0) onIndex(index - 1);
      if (event.key === "ArrowRight" && index < videos.length - 1) onIndex(index + 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [index, videos.length, onClose, onIndex]);

  return (
    <div className="video-viewer" role="dialog" aria-modal="true" aria-label="视频预览" onClick={onClose}>
      <div className="video-viewer-body" onClick={(event) => event.stopPropagation()}>
        <video key={current.path} src={`/api/media/${current.path}`} controls autoPlay playsInline />
        <div className="video-viewer-bar">
          <p title={prompt}>{prompt || current.name}</p>
          {videos.length > 1 && <span>{index + 1} / {videos.length}</span>}
          <a href={`/api/media/${current.path}?download=${encodeURIComponent(current.name)}`} download={current.name}><Download size={15} />下载</a>
        </div>
      </div>
      {index > 0 && <button type="button" className="video-viewer-nav prev" aria-label="上一个"
        onClick={(event) => { event.stopPropagation(); onIndex(index - 1); }}><ChevronLeft size={22} /></button>}
      {index < videos.length - 1 && <button type="button" className="video-viewer-nav next" aria-label="下一个"
        onClick={(event) => { event.stopPropagation(); onIndex(index + 1); }}><ChevronRight size={22} /></button>}
      <button type="button" className="video-viewer-close" onClick={onClose} aria-label="关闭"><X size={20} /></button>
    </div>
  );
}
