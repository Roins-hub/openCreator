import type { MediaRef, VideoOptions } from "./types";

/** 唯一内置的中转站。用户只需要在这里创建 API Key。 */
export const TANGZHI_BASE_URL = "https://new.tangzhi.org";
export const TANGZHI_KEY_PAGE = "https://new.tangzhi.org/console/token";
export const TANGZHI_PROVIDER_ID = "tangzhi";
export const TANGZHI_PROVIDER_NAME = "Tangzhi";

export type VideoResolution = VideoOptions["resolution"];
export type VideoRatio = Exclude<VideoOptions["ratio"], "adaptive">;
export type MediaKind = MediaRef["kind"];

export interface MediaLimits {
  images: number;
  audios: number;
  videos: number;
  /** 三类素材合计上限 */
  total: number;
}

export interface VideoModel {
  /** 中转站模型名,同时作为提交时的 model 参数 */
  id: string;
  tag: string;
  description: string;
  resolution: VideoResolution;
  /** 允许的整数秒数(范围型描述已展开) */
  durations: number[];
  ratios: VideoRatio[];
  limits: MediaLimits;
  /** 人脸策略:可真人 / 过人脸 / 卡人脸 */
  face: string;
  billing: "per_second" | "per_request";
  price: number;
  promptMin: number;
  promptMax: number;
  /**
   * 中转站这一路的请求格式:
   * - "videos":统一 /v1/videos 格式(duration / aspect_ratio / references),原样转发给上游
   * - "ark":火山方舟格式,经 new-api 的豆包插件转换,只认 seconds / metadata / images
   */
  protocol: "videos" | "ark";
}

const ALL_RATIOS: VideoRatio[] = ["16:9", "9:16", "1:1", "4:3", "3:4", "21:9"];
const RESOLUTIONS: VideoResolution[] = ["480p", "720p", "1080p", "4k"];

// 定价接口里没有的字段,按渠道标签补齐(与 docs.tangzhi.org 的 models.js 保持一致)。
const TAG_DEFAULTS: Record<string, { promptMax: number; ratios: VideoRatio[] }> = {
  CH01: { promptMax: 15000, ratios: ALL_RATIOS },
  CH08: { promptMax: 5000, ratios: ["9:16"] },
  // Dola 号池 2.2.5 起方舟兼容接口也放行 21:9
  DOLA: { promptMax: 5000, ratios: ALL_RATIOS },
  CH13: { promptMax: 5000, ratios: ALL_RATIOS },
  CH14: { promptMax: 6000, ratios: ALL_RATIOS },
};
const FALLBACK_DEFAULTS = { promptMax: 5000, ratios: ALL_RATIOS };

/**
 * 解析模型描述,例如
 * "(按秒计费) 9图片，3音频，3视频，合计≤12，720p，4s-15s，可真人"
 * "(按次计费) 30图片，10音频，0视频，合计≤40，720p，10s/30s，可真人"
 */
export function parseVideoDescription(description: string) {
  const text = String(description || "").replace(/\s+/g, "");
  const number = (pattern: RegExp) => {
    const match = text.match(pattern);
    return match ? Number(match[1]) : undefined;
  };
  const images = number(/(\d+)图片/);
  const audios = number(/(\d+)音频/);
  const videos = number(/(\d+)视频/);
  const total = number(/合计≤(\d+)/);
  const resolution = (text.match(/(480p|720p|1080p|4k)/i)?.[1] || "").toLowerCase() as VideoResolution | "";
  const durationText = text.match(/(\d+s(?:-\d+s|(?:\/\d+s)+)?)(?=，|,|$)/)?.[1] || "";
  const face = text.match(/(可真人|过人脸|卡人脸)/)?.[1] || "";
  return {
    images: images ?? 0,
    audios: audios ?? 0,
    videos: videos ?? 0,
    total: total ?? (images ?? 0) + (audios ?? 0) + (videos ?? 0),
    resolution: RESOLUTIONS.includes(resolution as VideoResolution) ? resolution as VideoResolution : undefined,
    durations: expandDurations(durationText),
    face,
  };
}

export function expandDurations(value: string) {
  const range = value.match(/^(\d+)s-(\d+)s$/);
  if (range) {
    const min = Number(range[1]);
    const max = Number(range[2]);
    return Array.from({ length: Math.max(0, max - min + 1) }, (_, index) => min + index);
  }
  const list = value.match(/\d+(?=s)/g);
  return list?.length ? [...new Set(list.map(Number))].sort((a, b) => a - b) : [];
}

interface PricingEntry {
  model_name?: string;
  description?: string | null;
  tags?: string | null;
  supported_endpoint_types?: string[];
  enable_groups?: string[];
  billing_mode?: string;
  billing_expr?: string;
  model_price?: number;
}

/** 豆包/Dola 这一路走 new-api 的方舟插件,请求格式和统一 /v1/videos 不同。 */
export function arkProtocol(tag: string, modelId: string) {
  return tag === "DOLA" || /^doubao-seedance/i.test(modelId);
}

/** 把 /api/pricing 的返回整理成可选的视频模型(描述不完整的模型不开放选择)。 */
export function toVideoModels(payload: unknown, group = "default"): VideoModel[] {
  const data = (payload as { data?: PricingEntry[]; group_ratio?: Record<string, number> }) || {};
  const groupRatio = Number(data.group_ratio?.[group] || 1);
  const models: VideoModel[] = [];
  for (const entry of data.data || []) {
    if (!entry.model_name || !entry.supported_endpoint_types?.includes("openai-video")) continue;
    if (entry.enable_groups && !entry.enable_groups.includes(group)) continue;
    const info = parseVideoDescription(entry.description || "");
    if (!info.resolution || !info.durations.length) continue;
    const tag = (String(entry.tags || "").split(",")[0] || "").trim().toUpperCase();
    const defaults = TAG_DEFAULTS[tag] || FALLBACK_DEFAULTS;
    const perSecond = entry.billing_mode === "tiered_expr" && /u\("seconds"\)/.test(entry.billing_expr || "");
    const perSecondPrice = entry.billing_expr?.match(/u\("seconds"\)\s*\*\s*([\d.]+)/)?.[1];
    models.push({
      id: entry.model_name,
      tag,
      protocol: arkProtocol(tag, entry.model_name) ? "ark" : "videos",
      description: entry.description || "",
      resolution: info.resolution,
      durations: info.durations,
      ratios: defaults.ratios,
      limits: { images: info.images, audios: info.audios, videos: info.videos, total: info.total },
      face: info.face,
      billing: perSecond ? "per_second" : "per_request",
      price: Number(perSecond && perSecondPrice ? perSecondPrice : entry.model_price || 0) * groupRatio,
      promptMin: 10,
      promptMax: defaults.promptMax,
    });
  }
  const order = (id: string) => id.replace(/-4k(?=$|-)/i, "-4000p");
  return models.sort((a, b) => order(a.id).localeCompare(order(b.id), "en", { numeric: true }));
}

export function formatPrice(model: Pick<VideoModel, "billing" | "price">) {
  return `¥${model.price.toFixed(2)}/${model.billing === "per_second" ? "秒" : "次"}`;
}

export function mediaSummary(limits: MediaLimits) {
  return `${limits.images}图片 · ${limits.audios}音频 · ${limits.videos}视频 · 合计≤${limits.total}`;
}

export function durationSummary(durations: number[]) {
  if (!durations.length) return "";
  const contiguous = durations.every((value, index) => index === 0 || value === durations[index - 1] + 1);
  return contiguous && durations.length > 2
    ? `${durations[0]}–${durations[durations.length - 1]}秒`
    : durations.map((value) => `${value}秒`).join(" / ");
}

/** 可选的生成方式。文生视频不用单独选:没有素材时自动按文生视频提交。 */
export type ReferenceMode = "first_last" | "references";

/** 旧记录里的「文生视频」「首帧」统一按参考素材处理(没有素材时即文生视频)。 */
export function normalizeReferenceMode(mode: VideoOptions["referenceMode"]): ReferenceMode {
  return mode === "first_last" ? "first_last" : "references";
}

/** 实际提交的方式:没有素材就是文生视频,有素材按所选方式。 */
export function effectiveReferenceMode(
  mode: VideoOptions["referenceMode"], attachmentCount: number,
): VideoOptions["referenceMode"] {
  return attachmentCount ? normalizeReferenceMode(mode) : "text";
}

export function countMedia(attachments: readonly Pick<MediaRef, "kind">[]) {
  return {
    images: attachments.filter((item) => item.kind === "image").length,
    audios: attachments.filter((item) => item.kind === "audio").length,
    videos: attachments.filter((item) => item.kind === "video").length,
  };
}

/** 在当前模式、模型和已选素材下,还能再加多少个某类素材。 */
export function remainingMedia(
  model: VideoModel, mode: VideoOptions["referenceMode"], attachments: readonly Pick<MediaRef, "kind">[], kind: MediaKind,
) {
  const normalized = normalizeReferenceMode(mode);
  const counts = countMedia(attachments);
  if (normalized === "first_last") return kind === "image" ? Math.max(0, 2 - counts.images) : 0;
  const perKind = kind === "image" ? model.limits.images - counts.images :
    kind === "audio" ? model.limits.audios - counts.audios : model.limits.videos - counts.videos;
  const total = model.limits.total - attachments.length;
  return Math.max(0, Math.min(perKind, total));
}

/** 模型不支持的参数自动收回到可用值(切换模型时调用)。 */
export function fitVideoOptions(model: VideoModel, options: VideoOptions): VideoOptions {
  const duration = model.durations.includes(options.duration) ? options.duration :
    model.durations.reduce((best, value) =>
      Math.abs(value - options.duration) < Math.abs(best - options.duration) ? value : best, model.durations[0]);
  const ratio = options.ratio !== "adaptive" && model.ratios.includes(options.ratio) ? options.ratio : model.ratios[0];
  return {
    ...options,
    referenceMode: normalizeReferenceMode(options.referenceMode),
    resolution: model.resolution,
    duration,
    ratio,
  };
}

/** 提交前的完整校验;返回第一条错误,全部满足时返回空字符串。 */
export function videoRequestError(
  model: VideoModel, prompt: string, options: VideoOptions, attachments: readonly Pick<MediaRef, "kind">[],
) {
  const length = [...prompt.trim()].length;
  if (length < model.promptMin) return `提示词至少需要 ${model.promptMin} 个字`;
  if (length > model.promptMax) return `提示词最多 ${model.promptMax} 个字`;
  if (options.resolution !== model.resolution) return `当前模型只支持 ${model.resolution.toUpperCase()}`;
  if (!model.durations.includes(options.duration)) return `当前模型支持的时长为 ${durationSummary(model.durations)}`;
  if (options.ratio === "adaptive" || !model.ratios.includes(options.ratio)) {
    return `当前模型支持的比例为 ${model.ratios.join(" / ")}`;
  }
  const counts = countMedia(attachments);
  const mode = effectiveReferenceMode(options.referenceMode, attachments.length);
  if (mode === "text") return "";
  if (mode === "first_last") {
    if (counts.audios || counts.videos) return "首尾帧模式只能使用图片";
    return counts.images === 2 ? "" : "首尾帧模式需要两张图片（首帧、尾帧）";
  }
  if (counts.images > model.limits.images) return `当前模型最多 ${model.limits.images} 张参考图`;
  if (counts.audios > model.limits.audios) {
    return model.limits.audios ? `当前模型最多 ${model.limits.audios} 个参考音频` : "当前模型不支持参考音频";
  }
  if (counts.videos > model.limits.videos) {
    return model.limits.videos ? `当前模型最多 ${model.limits.videos} 个参考视频` : "当前模型不支持参考视频";
  }
  if (attachments.length > model.limits.total) return `当前模型素材合计最多 ${model.limits.total} 个`;
  return "";
}

const single = (urls: string[], one: string, many: string) =>
  urls.length === 1 ? { [one]: urls[0] } : urls.length > 1 ? { [many]: urls } : {};

/** 构造 POST /v1/videos 请求体(素材以公网 URL 传递,单个用单数字段,多个用复数字段)。 */
export function buildVideoRequest(
  model: VideoModel, prompt: string, options: VideoOptions,
  attachments: readonly MediaRef[], mediaUrl: (media: MediaRef) => string, clientTaskId: string,
) {
  const urls = (kind: MediaKind) => attachments.filter((item) => item.kind === kind).map(mediaUrl);
  const mode = effectiveReferenceMode(options.referenceMode, attachments.length);
  if (model.protocol === "ark") return buildArkRequest(model, prompt, options, mode, urls("image"));
  const body: Record<string, unknown> = {
    model: model.id,
    prompt: prompt.trim(),
    client_task_id: clientTaskId,
    mode: mode === "first_last" ? "frames" : "references",
    aspect_ratio: options.ratio,
    duration: options.duration,
    resolution: options.resolution,
  };
  if (mode === "first_last") {
    const [first, last] = urls("image");
    body.frames = { first_frame: first, last_frame: last };
  } else if (mode === "references" && attachments.length) {
    body.references = {
      ...single(urls("image"), "image", "images"),
      ...single(urls("video"), "video", "videos"),
      ...single(urls("audio"), "audio", "audios"),
    };
  }
  return body;
}

/**
 * 方舟格式(new-api 豆包插件):时长只认 `seconds`,比例和分辨率放在 `metadata` 里,
 * 参考图走 `images`,首尾帧放在 `metadata.content` 并标明 role。
 * 用 duration / aspect_ratio / references 会被插件丢掉,上游只能收到提示词(时长落到 5 秒)。
 */
function buildArkRequest(
  model: VideoModel, prompt: string, options: VideoOptions,
  mode: VideoOptions["referenceMode"], images: string[],
) {
  const metadata: Record<string, unknown> = { ratio: options.ratio, resolution: options.resolution };
  const body: Record<string, unknown> = {
    model: model.id,
    prompt: prompt.trim(),
    seconds: String(options.duration),
    metadata,
  };
  if (mode === "first_last") {
    const [first, last] = images;
    metadata.content = [
      { type: "image_url", image_url: { url: first }, role: "first_frame" },
      { type: "image_url", image_url: { url: last }, role: "last_frame" },
    ];
  } else if (images.length) {
    body.images = images;
  }
  return body;
}
