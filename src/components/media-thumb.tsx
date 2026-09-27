import { Music } from "lucide-react";
import type { MediaRef } from "@/lib/types";

/** 参考素材缩略图:图片直接显示,视频取首帧,音频显示音符图标。 */
export function MediaThumb({ media, src, alt = "" }: { media: Pick<MediaRef, "kind" | "path" | "name">; src?: string; alt?: string }) {
  const url = src || `/api/media/${media.path}`;
  if (media.kind === "video") {
    return <video className="media-thumb" src={url.startsWith("blob:") ? url : `${url}#t=0.1`}
      muted playsInline preload="metadata" aria-label={alt || media.name} />;
  }
  if (media.kind === "audio") {
    return <span className="media-thumb audio-thumb" aria-label={alt || media.name}><Music size={16} /></span>;
  }
  // eslint-disable-next-line @next/next/no-img-element
  return <img className="media-thumb" src={url} alt={alt} draggable={false} />;
}
