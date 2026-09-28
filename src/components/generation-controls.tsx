"use client";

import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, SlidersHorizontal } from "lucide-react";
import type { VideoOptions } from "@/lib/types";
import {
  durationSummary, normalizeReferenceMode, type ReferenceMode, type VideoModel, type VideoRatio,
} from "@/lib/tangzhi";

const videoRatios: VideoRatio[] = ["21:9", "16:9", "4:3", "1:1", "3:4", "9:16"];
const resolutions: VideoOptions["resolution"][] = ["480p", "720p", "1080p", "4k"];
const durationPresets = [3, 4, 5, 6, 7, 8, 9, 10, 15, 20, 30];
const UNSUPPORTED = "当前模型不支持";

function useDismiss(open: boolean, close: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const pointer = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) close();
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    document.addEventListener("mousedown", pointer);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("mousedown", pointer);
      document.removeEventListener("keydown", key);
    };
  }, [open, close]);
  return ref;
}

function Segmented<T extends string | number | boolean>({
  values, value, onChange, format = String, isDisabled,
}: {
  values: readonly T[];
  value: T;
  onChange: (value: T) => void;
  format?: (value: T) => string;
  isDisabled?: (value: T) => boolean;
}) {
  return <div className="parameter-segments">
    {values.map((item) => {
      const disabled = isDisabled?.(item) ?? false;
      return <button type="button" key={String(item)} disabled={disabled}
        title={disabled ? UNSUPPORTED : undefined}
        className={item === value ? "selected" : ""} onClick={() => onChange(item)}>
        {format(item)}
      </button>;
    })}
  </div>;
}

export const modeLabels: Record<ReferenceMode, string> = {
  first_last: "首尾帧", references: "参考生成",
};

export function VideoControls({
  value, model, attachmentCount, onChange,
}: {
  value: VideoOptions;
  model: VideoModel;
  /** 已添加的素材数;为 0 时自动按文生视频生成 */
  attachmentCount: number;
  onChange: (value: VideoOptions) => void;
}) {
  const [modeOpen, setModeOpen] = useState(false);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [customDuration, setCustomDuration] = useState(false);
  const close = () => { setModeOpen(false); setOptionsOpen(false); };
  const ref = useDismiss(modeOpen || optionsOpen, close);
  const mode = normalizeReferenceMode(value.referenceMode);
  const { durations, limits } = model;
  const minDuration = durations[0];
  const maxDuration = durations[durations.length - 1];
  // 连续区间(如 4–15 秒)允许自定义任意整数秒;离散值(如 10/30 秒)只能点选
  const contiguous = durations.every((item, index) => index === 0 || item === durations[index - 1] + 1);
  const durationButtons = [...new Set([...durationPresets, ...(contiguous ? [minDuration, maxDuration] : durations)])]
    .sort((a, b) => a - b);
  const showCustom = customDuration || !durationButtons.includes(value.duration);
  const media = [
    limits.images && `${limits.images} 张图片`,
    limits.videos && `${limits.videos} 个视频`,
    limits.audios && `${limits.audios} 个音频`,
  ].filter(Boolean).join("、");

  return <div className="video-parameter-group" ref={ref}>
    <div className="parameter-control">
      <button type="button" className={`parameter-trigger mode-trigger ${modeOpen ? "active" : ""}`}
        aria-expanded={modeOpen} onClick={() => { setModeOpen((open) => !open); setOptionsOpen(false); }}>
        {attachmentCount ? modeLabels[mode] : "文生视频"} <ChevronDown size={13} />
      </button>
      {modeOpen && <div className="mode-popover">
        <small>上传素材后的生成方式 · 不上传素材即为文生视频</small>
        {([
          ["references", "参考生成", `用素材控制主体、动作、风格或声音；最多 ${media}，合计不超过 ${limits.total} 个`],
          ["first_last", "首尾帧", "上传两张图片，分别作为视频的开头和结尾画面"],
        ] as const).map(([item, title, note]) => <button type="button" key={item}
          className={mode === item ? "selected" : ""}
          onClick={() => { onChange({ ...value, referenceMode: item }); setModeOpen(false); }}>
          <span><b>{title}</b><small>{note}</small></span>
          {mode === item && <Check size={15} />}
        </button>)}
      </div>}
    </div>
    <div className="parameter-control">
      <button type="button" className={`parameter-trigger ${optionsOpen ? "active" : ""}`}
        aria-expanded={optionsOpen} onClick={() => { setOptionsOpen((open) => !open); setModeOpen(false); }}>
        <SlidersHorizontal size={14} />
        <span>{value.ratio}</span><i /><span>{value.resolution.toUpperCase()}</span><i />
        <span>{value.duration}秒</span><i /><span>{value.count}条</span>
      </button>
      {optionsOpen && <div className="parameter-popover video-parameter-popover">
        <section><h3>视频比例</h3>
          <div className="ratio-grid video-ratios">
            {videoRatios.map((ratio) => {
              const disabled = !model.ratios.includes(ratio);
              return <button type="button" key={ratio} disabled={disabled}
                title={disabled ? UNSUPPORTED : undefined}
                className={value.ratio === ratio ? "selected" : ""}
                onClick={() => onChange({ ...value, ratio })}>
                <span className={`ratio-shape ratio-${ratio.replace(":", "-")}`} /><b>{ratio}</b>
              </button>;
            })}
          </div>
        </section>
        <section><h3>分辨率<small>由所选模型决定</small></h3>
          <Segmented values={resolutions} value={value.resolution}
            format={(resolution) => resolution.toUpperCase()}
            isDisabled={(resolution) => resolution !== model.resolution}
            onChange={(resolution) => onChange({ ...value, resolution })} />
        </section>
        <section><h3>视频时长<small>{durationSummary(durations)}</small></h3>
          <div className="duration-picker">
            <Segmented values={durationButtons} value={value.duration}
              format={(duration) => `${duration}s`}
              isDisabled={(duration) => !durations.includes(duration)}
              onChange={(duration) => {
                setCustomDuration(false);
                onChange({ ...value, duration });
              }} />
            {contiguous && <button type="button" className={showCustom ? "selected" : ""}
              onClick={() => setCustomDuration(true)}>自定义</button>}
          </div>
          {contiguous && showCustom && <label className="custom-duration">
            <span>自定义秒数</span>
            <input type="number" min={minDuration} max={maxDuration} step={1}
              value={value.duration}
              onChange={(event) => {
                const duration = Math.min(maxDuration, Math.max(minDuration, Math.round(Number(event.target.value)) || minDuration));
                onChange({ ...value, duration });
              }} />
            <small>{minDuration}–{maxDuration} 秒</small>
          </label>}
        </section>
        <section><h3>生成数量</h3>
          <Segmented values={[1, 2, 3, 4] as const} value={value.count}
            onChange={(count) => onChange({ ...value, count })} />
        </section>
      </div>}
    </div>
  </div>;
}
