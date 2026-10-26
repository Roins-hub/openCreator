"use client";

import { useState, type VideoHTMLAttributes } from "react";

const mb = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`;

/**
 * 放大预览里原图 / 视频的加载进度:中间一条细进度条和百分比;
 * 不知道总大小时显示来回滑动的进度条。
 */
export function LoadProgress({ label, percent, loaded, total, className = "" }: {
  label: string;
  /** 0–100;不知道时不传 */
  percent?: number;
  /** 已下载 / 总字节数(知道时显示「1.2 MB / 2.3 MB」) */
  loaded?: number;
  total?: number;
  className?: string;
}) {
  const value = percent === undefined ? undefined : Math.max(0, Math.min(100, Math.round(percent)));
  return <div className={`load-progress ${className}`} role="progressbar" aria-label={label}
    aria-valuemin={0} aria-valuemax={100} aria-valuenow={value}>
    <span className="load-progress-text">
      {label}{value === undefined ? "…" : ` ${value}%`}
      {loaded !== undefined && total ? <small>{mb(loaded)} / {mb(total)}</small> : null}
    </span>
    <span className={`load-progress-track ${value === undefined ? "is-indeterminate" : ""}`}>
      <i style={value === undefined ? undefined : { width: `${value}%` }} />
    </span>
  </div>;
}

/** 已缓冲到第几秒占总时长的比例(0–100);还不知道时长时为 undefined */
function bufferedPercent(video: HTMLVideoElement) {
  const duration = video.duration;
  if (!Number.isFinite(duration) || duration <= 0) return undefined;
  let end = 0;
  for (let index = 0; index < video.buffered.length; index++) end = Math.max(end, video.buffered.end(index));
  return (end / duration) * 100;
}

/**
 * 放大预览里的视频:上方显示缓冲进度(「加载视频…」→「缓冲中 45%」),
 * 缓冲完(或浏览器判断能一口气播完)就收起。
 */
export function ProgressVideo(props: VideoHTMLAttributes<HTMLVideoElement> & { src: string }) {
  const [percent, setPercent] = useState<number>();
  const [done, setDone] = useState(false);
  const update = (video: HTMLVideoElement) => {
    const next = bufferedPercent(video);
    setPercent(next);
    if (next !== undefined && next >= 99.5) setDone(true);
  };
  return <div className="progress-video">
    <video {...props}
      onLoadedMetadata={(event) => { update(event.currentTarget); props.onLoadedMetadata?.(event); }}
      onProgress={(event) => { update(event.currentTarget); props.onProgress?.(event); }}
      onCanPlayThrough={(event) => { setDone(true); props.onCanPlayThrough?.(event); }} />
    {!done && <LoadProgress className="is-top" label={percent === undefined ? "加载视频" : "缓冲中"} percent={percent} />}
  </div>;
}
