import type { MediaRef } from "./types";

type MediaKind = MediaRef["kind"];
type MediaFile = { name: string; type: string; size: number };

const MB = 1024 * 1024;

/** 可上传的参考素材格式与单个文件大小上限(站点反代单次请求上限 50MB,文件逐个上传)。 */
export const MEDIA_RULES: Record<MediaKind, { types: string[]; extensions: string[]; maxBytes: number; label: string }> = {
  image: { types: ["image/jpeg", "image/png", "image/webp"], extensions: [".jpg", ".jpeg", ".png", ".webp"], maxBytes: 15 * MB, label: "JPG、PNG、WebP 图片" },
  video: { types: ["video/mp4", "video/quicktime"], extensions: [".mp4", ".mov"], maxBytes: 45 * MB, label: "MP4、MOV 视频" },
  audio: { types: ["audio/mpeg", "audio/mp3", "audio/wav", "audio/x-wav", "audio/wave"], extensions: [".mp3", ".wav"], maxBytes: 15 * MB, label: "MP3、WAV 音频" },
};

export const MEDIA_KIND_LABEL: Record<MediaKind, string> = { image: "图片", video: "视频", audio: "音频" };

const extensionOf = (name: string) => {
  const index = name.lastIndexOf(".");
  return index >= 0 ? name.slice(index).toLowerCase() : "";
};

export function uploadKind(file: Pick<MediaFile, "name" | "type">): MediaKind | undefined {
  const extension = extensionOf(file.name);
  return (Object.keys(MEDIA_RULES) as MediaKind[]).find((kind) =>
    MEDIA_RULES[kind].types.includes(file.type) ||
    (!file.type && MEDIA_RULES[kind].extensions.includes(extension)));
}

export function acceptAttribute(kinds: readonly MediaKind[]) {
  return kinds.flatMap((kind) => [...MEDIA_RULES[kind].types, ...MEDIA_RULES[kind].extensions]).join(",");
}

/**
 * 按每类素材还能添加的数量(remaining)和合计余量(remainingTotal)筛选文件;超出、格式或大小不符的给出第一条提示。
 */
export function pickMediaFiles<T extends MediaFile>(
  files: readonly T[], remaining: Record<MediaKind, number>, remainingTotal = Number.POSITIVE_INFINITY,
) {
  const left = { ...remaining };
  let totalLeft = remainingTotal;
  const accepted: Array<{ file: T; kind: MediaKind }> = [];
  let error = "";
  for (const file of files) {
    const kind = uploadKind(file);
    if (!kind) { error ||= "仅支持 JPG/PNG/WebP 图片、MP4/MOV 视频和 MP3/WAV 音频"; continue; }
    if (file.size > MEDIA_RULES[kind].maxBytes) {
      error ||= `单个${MEDIA_KIND_LABEL[kind]}不能超过 ${MEDIA_RULES[kind].maxBytes / MB}MB`;
      continue;
    }
    if (left[kind] <= 0) {
      error ||= remaining[kind] > 0
        ? `已达到当前模型的${MEDIA_KIND_LABEL[kind]}数量上限`
        : `当前模型或模式不支持参考${MEDIA_KIND_LABEL[kind]}`;
      continue;
    }
    if (totalLeft <= 0) { error ||= "已达到当前模型的素材合计上限"; continue; }
    left[kind] -= 1;
    totalLeft -= 1;
    accepted.push({ file, kind });
  }
  return { accepted, ...(error ? { error } : {}) };
}
