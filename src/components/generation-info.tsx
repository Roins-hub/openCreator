"use client";

import { useState } from "react";
import { Check, Copy, X } from "lucide-react";
import type { MediaRef, Message, VideoOptions } from "@/lib/types";
import { referenceLabels } from "@/lib/prompt-references";
import { MediaThumb } from "@/components/media-thumb";

const VIDEO_MODES: Record<VideoOptions["referenceMode"], string> = {
  text: "文生视频", first: "首帧生成", first_last: "首尾帧", references: "参考生成",
};
const BACKGROUNDS = { auto: "自动", opaque: "不透明", transparent: "透明" } as const;

/** 文件大小:812 KB / 2.1 MB */
export function formatBytes(bytes?: number) {
  if (bytes === undefined || !Number.isFinite(bytes) || bytes <= 0) return "";
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

function formatSpan(ms: number) {
  const total = Math.max(0, Math.round(ms / 1000));
  if (total < 60) return `${total} 秒`;
  const minutes = Math.floor(total / 60);
  return minutes < 60 ? `${minutes} 分 ${total % 60} 秒` : `${Math.floor(minutes / 60)} 小时 ${minutes % 60} 分`;
}

const fullTime = (iso: string) => {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleString("zh-CN", { hour12: false });
};

/**
 * 放大预览右侧的「生成信息」:模型、生成方式、参数、文件大小、提示词(可复制)、参考素材、时间和任务 ID。
 */
export function GenerationInfo({ message, prompt, references, media, size, fallbackModelName, onClose }: {
  message: Message;
  prompt: string;
  references: MediaRef[];
  /** 当前正在看的那个文件 */
  media: MediaRef;
  size?: number;
  fallbackModelName?: string;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState("");
  const generation = message.generation;
  const video = generation?.videoOptions && media.kind === "video" ? generation.videoOptions : undefined;
  const image = generation?.imageOptions && media.kind === "image" ? generation.imageOptions : undefined;
  const taskIds = message.taskIds?.length ? message.taskIds : message.taskId ? [message.taskId] : [];
  const labels = referenceLabels(references);

  const copy = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(label);
      window.setTimeout(() => setCopied(""), 1400);
    } catch { setCopied(""); }
  };

  const rows: [string, string][] = [
    ["模型", generation?.modelName || fallbackModelName || ""],
    ["类型", media.kind === "video"
      ? video ? (references.length ? VIDEO_MODES[video.referenceMode] : "文生视频") : "视频"
      : references.length ? "图生图" : "文生图"],
    ["比例", video ? (video.ratio === "adaptive" ? "智能比例" : video.ratio) : image?.ratio || ""],
    ["分辨率", video ? video.resolution.toUpperCase() : image ? image.resolution.toUpperCase() : ""],
    ["时长", video ? `${video.duration} 秒` : ""],
    ["声音", video ? (video.audio ? "有" : "无") : ""],
    ["格式", image ? image.format.toUpperCase() : media.kind === "video" ? "MP4" : ""],
    ["背景", image && image.background !== "auto" ? BACKGROUNDS[image.background] : ""],
    ["数量", (video?.count || image?.count || 1) > 1 ? `${video?.count || image?.count} ${media.kind === "video" ? "条" : "张"}` : ""],
    ["文件大小", formatBytes(size ?? media.size)],
  ];

  return <aside className="generation-info" aria-label="生成信息" onClick={(event) => event.stopPropagation()}>
    <header>
      <strong>生成信息</strong>
      <button type="button" onClick={onClose} aria-label="收起生成信息" title="收起"><X size={16} /></button>
    </header>
    <dl>
      {rows.filter(([, value]) => value).map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
    </dl>
    <section className="generation-info-prompt">
      <div className="generation-info-label">
        <span>提示词</span>
        {prompt && <button type="button" onClick={() => void copy(prompt, "prompt")} title="复制提示词" aria-label="复制提示词">
          {copied === "prompt" ? <Check size={13} /> : <Copy size={13} />}
        </button>}
      </div>
      <p>{prompt || "（无提示词）"}</p>
    </section>
    {references.length > 0 && <section>
      <div className="generation-info-label"><span>参考素材</span></div>
      <div className="generation-info-refs">
        {references.map((ref, index) => <span key={`${ref.path}-${index}`} title={`${labels[index]} · ${ref.name}`}>
          <MediaThumb media={ref} alt={ref.name} /><i>{labels[index]}</i>
        </span>)}
      </div>
    </section>}
    <dl>
      <div><dt>生成时间</dt><dd>{fullTime(message.createdAt)}</dd></div>
      {message.elapsedMs !== undefined && <div><dt>用时</dt><dd>{formatSpan(message.elapsedMs)}</dd></div>}
      {taskIds.length > 0 && <div><dt>任务 ID</dt><dd className="generation-info-id">
        <span>{taskIds.join("\n")}</span>
        <button type="button" onClick={() => void copy(taskIds.join("\n"), "task")} title="复制任务 ID" aria-label="复制任务 ID">
          {copied === "task" ? <Check size={12} /> : <Copy size={12} />}
        </button>
      </dd></div>}
    </dl>
  </aside>;
}
