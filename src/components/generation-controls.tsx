"use client";

import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, SlidersHorizontal } from "lucide-react";
import { useSlidingIndicator } from "@/components/sliding-indicator";
import type { ImageOptions, VideoOptions } from "@/lib/types";
import {
  BACKGROUND_LABEL, nearestChatRatio, IMAGE_BACKGROUNDS, IMAGE_FORMATS, IMAGE_RATIOS, IMAGE_RESOLUTIONS, imageSize, isPresetRatio,
  MAX_RATIO_SPAN, parseRatio, tierPrice, yuan, type ImageModel,
} from "@/lib/image-models";
import {
  durationSummary, normalizeReferenceMode, VIDEO_RESOLUTIONS, type ReferenceMode, type VideoModel,
} from "@/lib/tangzhi";

const videoRatios: VideoOptions["ratio"][] = ["adaptive", "21:9", "16:9", "4:3", "1:1", "3:4", "9:16"];
const ratioLabel = (ratio: VideoOptions["ratio"]) => ratio === "adaptive" ? "智能" : ratio;
// 常见的几档一直列出(模型不支持的置灰),模型自己特有的档位(768P、2K)只在支持时出现
const COMMON_RESOLUTIONS: VideoOptions["resolution"][] = ["480p", "720p", "1080p", "4k"];
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
  const { containerRef, indicator } = useSlidingIndicator<HTMLDivElement>();
  return <div className="parameter-segments has-slider" ref={containerRef}>
    {indicator}
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
  const { containerRef: ratioSliderRef, indicator: ratioIndicator } = useSlidingIndicator<HTMLDivElement>();
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
          ["first_last", "首尾帧", model.frames ? "上传两张图片，分别作为视频的开头和结尾画面" : "当前模型不支持首尾帧"],
        ] as const).map(([item, title, note]) => <button type="button" key={item}
          className={mode === item ? "selected" : ""} disabled={item === "first_last" && !model.frames}
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
        <span>{ratioLabel(value.ratio)}</span><i /><span>{value.resolution.toUpperCase()}</span><i />
        <span>{value.duration}秒</span><i /><span>{value.count}条</span>
      </button>
      {optionsOpen && <div className="parameter-popover video-parameter-popover">
        <section><h3>视频比例{value.ratio === "adaptive" && <small>按第一张参考图的比例；没有参考图时按提示词（如「竖屏」「宽银幕」），默认 16:9</small>}</h3>
          <div className="ratio-grid video-ratios has-slider" ref={ratioSliderRef}>
            {ratioIndicator}
            {videoRatios.map((ratio) => {
              const disabled = ratio === "adaptive" ? model.ratios.length < 2 : !model.ratios.includes(ratio);
              return <button type="button" key={ratio} disabled={disabled}
                title={disabled ? UNSUPPORTED : ratio === "adaptive" ? "根据参考图或提示词自动选择比例" : undefined}
                className={value.ratio === ratio ? "selected" : ""}
                onClick={() => onChange({ ...value, ratio })}>
                <span className={`ratio-shape ratio-${ratio.replace(":", "-")}`} /><b>{ratioLabel(ratio)}</b>
              </button>;
            })}
          </div>
        </section>
        <section><h3>分辨率<small>{model.resolutions.length > 1
          ? `当前模型可选 ${model.resolutions.map((item) => item.toUpperCase()).join(" / ")}` : "由所选模型决定"}</small></h3>
          <Segmented values={VIDEO_RESOLUTIONS.filter((item) => COMMON_RESOLUTIONS.includes(item) || model.resolutions.includes(item))}
            value={value.resolution}
            format={(resolution) => resolution.toUpperCase()}
            isDisabled={(resolution) => !model.resolutions.includes(resolution)}
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

/** 生图参数:比例、分辨率(中转站阶梯计价的 1K / 2K / 4K)、背景、格式、数量 */
export function ImageControls({
  value, model, onChange,
}: {
  value: ImageOptions;
  model: ImageModel;
  onChange: (value: ImageOptions) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useDismiss(open, () => setOpen(false));
  const { width, height } = imageSize(value.ratio, value.resolution, model.sizes);
  // 模型描述里锁定的比例 / 档位;没写的不限制
  const ratioAllowed = (ratio: string) => (!model.ratios?.length || model.ratios.includes(ratio)) && !model.excludedRatios.includes(ratio);
  const presetRatios = [...IMAGE_RATIOS, ...(model.ratios || []).filter((ratio) => !isPresetRatio(ratio))];
  // 自定义比例:输入框里的草稿,合法时才写回参数
  const [customOpen, setCustomOpen] = useState(false);
  const { containerRef: ratioSliderRef, indicator: ratioIndicator } = useSlidingIndicator<HTMLDivElement>();
  const current = parseRatio(value.ratio) || [1, 1];
  const [draft, setDraft] = useState<[string, string]>([String(current[0]), String(current[1])]);
  const custom = !model.ratios?.length && (customOpen || !isPresetRatio(value.ratio));
  const draftRatio = `${draft[0]}:${draft[1]}`;
  const draftValid = Boolean(parseRatio(draftRatio));
  const changeDraft = (next: [string, string]) => {
    setDraft(next);
    const ratio = `${next[0]}:${next[1]}`;
    if (parseRatio(ratio)) onChange({ ...value, ratio });
  };
  const priced = model.price.kind === "per_image" && model.price.tiers.length > 1;
  // Nano Banana 等对话式生图:比例按最接近的支持比例,不能选背景和格式
  const chatApi = model.api === "chat";
  const chatRatio = chatApi ? nearestChatRatio(value.ratio) : value.ratio;
  return <div className="video-parameter-group" ref={ref}>
    <div className="parameter-control">
      <button type="button" className={`parameter-trigger ${open ? "active" : ""}`}
        aria-expanded={open} onClick={() => setOpen((current) => !current)}>
        <SlidersHorizontal size={14} />
        <span>{chatRatio}</span><i /><span>{value.resolution.toUpperCase()}</span><i />
        {!chatApi && <><span>{value.format.toUpperCase()}</span><i /></>}<span>{value.count}张</span>
      </button>
      {open && <div className="parameter-popover video-parameter-popover image-parameter-popover">
        <section><h3>图片比例<small>{chatApi ? `按 ${chatRatio} · ${value.resolution.toUpperCase()} 请求，实际尺寸以模型返回为准`
          : `按 ${width} × ${height} 请求，实际尺寸以中转站返回为准`}</small></h3>
          <div className="ratio-grid image-ratios has-slider" ref={ratioSliderRef}>
            {ratioIndicator}
            {presetRatios.map((ratio) => <button type="button" key={ratio}
              className={value.ratio === ratio && !custom ? "selected" : ""} disabled={!ratioAllowed(ratio)}
              title={ratioAllowed(ratio) ? undefined : "当前模型不支持这个比例"}
              onClick={() => { setCustomOpen(false); onChange({ ...value, ratio }); }}>
              <span className={`ratio-shape ratio-${ratio.replace(":", "-")}`} /><b>{ratio}</b>
            </button>)}
            {!model.ratios?.length && <button type="button" className={custom ? "selected" : ""}
              onClick={() => {
                setCustomOpen(true);
                const [w, h] = parseRatio(value.ratio) || [1, 1];
                setDraft([String(w), String(h)]);
              }}>
              <span className="ratio-shape ratio-adaptive" /><b>自定义</b>
            </button>}
          </div>
          {model.ratios?.length ? <p className="parameter-note">当前模型只支持 {model.ratios.join(" / ")}</p> : null}
          {custom && <div className="custom-size custom-ratio">
            <label>宽<input type="number" min={1} max={999} value={draft[0]} aria-label="自定义比例的宽"
              onChange={(event) => changeDraft([event.target.value, draft[1]])} /></label>
            <span>:</span>
            <label>高<input type="number" min={1} max={999} value={draft[1]} aria-label="自定义比例的高"
              onChange={(event) => changeDraft([draft[0], event.target.value])} /></label>
          </div>}
          {chatApi && custom && draftValid && chatRatio !== value.ratio && <p className="parameter-note">
            {model.id} 只支持固定比例，会按最接近的 {chatRatio} 生成</p>}
          {custom && !draftValid && <p className="parameter-note parameter-error">
            请填 1~999 的整数，长边不超过短边的 {MAX_RATIO_SPAN} 倍（当前仍按 {value.ratio}）</p>}
          {custom && draftValid && model.excludedRatios.includes(draftRatio) && <p className="parameter-note parameter-error">
            当前模型不支持 {draftRatio}</p>}
        </section>
        <section><h3>分辨率<small>{model.resolutions.length < IMAGE_RESOLUTIONS.length
          ? `当前模型只支持 ${model.resolutions.map((item) => item.toUpperCase()).join(" / ")}`
          : priced ? "价格与中转站阶梯计价同步" : "2K / 4K 耗时更长"}</small></h3>
          <Segmented values={IMAGE_RESOLUTIONS} value={value.resolution}
            isDisabled={(resolution) => !model.resolutions.includes(resolution)}
            format={(resolution) => {
              const price = priced ? tierPrice(model.price, resolution) : undefined;
              return price === undefined ? resolution.toUpperCase() : `${resolution.toUpperCase()} · ${yuan(price)}`;
            }}
            onChange={(resolution) => onChange({ ...value, resolution })} />
        </section>
        {!chatApi && <><section><h3>背景</h3>
          <Segmented values={IMAGE_BACKGROUNDS} value={value.background}
            format={(background) => BACKGROUND_LABEL[background]}
            onChange={(background) => onChange({
              ...value, background,
              // 透明背景只有 PNG / WebP 能保存
              format: background === "transparent" && value.format === "jpeg" ? "png" : value.format,
            })} />
        </section>
        <section><h3>格式</h3>
          <Segmented values={IMAGE_FORMATS} value={value.format}
            format={(format) => format.toUpperCase()}
            isDisabled={(format) => format === "jpeg" && value.background === "transparent"}
            onChange={(format) => onChange({ ...value, format })} />
        </section></>}
        <section><h3>生成数量<small>每张单独生成并计费</small></h3>
          <Segmented values={[1, 2, 3, 4] as const} value={value.count}
            onChange={(count) => onChange({ ...value, count })} />
        </section>
        <p className="parameter-note">{model.maxReferences
          ? `最多 ${model.maxReferences} 张参考图；有参考图时按图修改。` : "当前模型只支持文生图，不能加参考图。"}</p>
      </div>}
    </div>
  </div>;
}
