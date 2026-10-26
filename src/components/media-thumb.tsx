"use client";

import { useState, type ImgHTMLAttributes, type VideoHTMLAttributes } from "react";
import { Music } from "lucide-react";
import { mediaUrl, thumbUrl } from "@/lib/media-url";
import type { MediaRef } from "@/lib/types";

/**
 * 缩略图:先要云存储现场缩小的 WebP(几十 KB),拿不到(格式不支持、存储不支持处理)时退回原图。
 */
export function ThumbImage({ path, width = 480, alt = "", ...props }: { path: string; width?: number } & ImgHTMLAttributes<HTMLImageElement>) {
  const [failed, setFailed] = useState(false);
  // eslint-disable-next-line @next/next/no-img-element
  return <img loading="lazy" decoding="async" draggable={false} alt={alt} {...props}
    src={failed ? mediaUrl(path) : thumbUrl(path, width)}
    onError={(event) => { if (!failed) setFailed(true); else props.onError?.(event); }} />;
}

/**
 * 视频预览:封面用云存储截的首帧(十几 KB),不预读视频本身,播放时才开始加载;
 * 截不到封面时退回预读元数据显示首帧。
 */
export function PosterVideo({ path, width = 480, ...props }: { path: string; width?: number } & VideoHTMLAttributes<HTMLVideoElement>) {
  const [failed, setFailed] = useState(false);
  const poster = thumbUrl(path, width);
  return <>
    <video {...props} src={mediaUrl(path)} poster={failed ? undefined : poster} preload={failed ? "metadata" : "none"} />
    {/* 探测封面能不能拿到(video 的 poster 加载失败没有事件) */}
    {/* 用内联 display:none 而不是 hidden 属性:外面的 img { display: block } 之类样式会盖掉 hidden */}
    {/* eslint-disable-next-line @next/next/no-img-element */}
    {!failed && <img alt="" aria-hidden="true" style={{ display: "none" }} src={poster} onError={() => setFailed(true)} />}
  </>;
}

/** 参考素材缩略图:图片显示缩略图,视频显示截帧封面,音频显示音符图标。src 是还在上传时的本地预览地址。 */
export function MediaThumb({ media, src, alt = "", width = 240 }: {
  media: Pick<MediaRef, "kind" | "path" | "name">; src?: string; alt?: string; width?: number;
}) {
  const [videoFallback, setVideoFallback] = useState(false);
  if (media.kind === "audio") {
    return <span className="media-thumb audio-thumb" aria-label={alt || media.name}><Music size={16} /></span>;
  }
  if (media.kind === "video") {
    if (src || videoFallback) {
      const url = src || mediaUrl(media.path);
      return <video className="media-thumb" src={url.startsWith("blob:") ? url : `${url}#t=0.1`}
        muted playsInline preload="metadata" aria-label={alt || media.name} />;
    }
    // eslint-disable-next-line @next/next/no-img-element
    return <img className="media-thumb" src={thumbUrl(media.path, width)} alt={alt || media.name} draggable={false}
      loading="lazy" decoding="async" onError={() => setVideoFallback(true)} />;
  }
  if (src) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img className="media-thumb" src={src} alt={alt} draggable={false} />;
  }
  return <ThumbImage className="media-thumb" path={media.path} width={width} alt={alt} />;
}
