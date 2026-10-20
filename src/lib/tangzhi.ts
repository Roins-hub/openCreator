import type { MediaRef, VideoOptions } from "./types";
import { classifyModel, vendorNames } from "./model-catalog";
import { specClauses, specDurations, specFace, specMedia, specRatios, specResolutions } from "./model-spec";

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
  type: "video";
  /** 中转站模型名,同时作为提交时的 model 参数 */
  id: string;
  tag: string;
  description: string;
  /** 默认分辨率(描述里写了「默认」的那个,否则是可选的第一个) */
  resolution: VideoResolution;
  /** 可选分辨率(从描述里读出;只写了一个就只有一个) */
  resolutions: VideoResolution[];
  /** 是否支持首尾帧(描述写了「不支持 / 不接首尾帧」「仅参考素材模式」时为 false) */
  frames: boolean;
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
  /** 模型选择面板的分组:厂商 → 系列 */
  vendor: string;
  series: string;
  /** 自定义中转站里只知道名字的模型:参数用通用值,价格未知 */
  generic?: boolean;
}

const ALL_RATIOS: VideoRatio[] = ["16:9", "9:16", "1:1", "4:3", "3:4", "21:9"];
/** 从低到高;界面按这个顺序列出 */
export const VIDEO_RESOLUTIONS: VideoResolution[] = ["480p", "720p", "768p", "1080p", "2k", "4k"];
const RESOLUTIONS = VIDEO_RESOLUTIONS;
const isResolution = (value: string): value is VideoResolution => (RESOLUTIONS as string[]).includes(value);
const isRatio = (value: string): value is VideoRatio => (ALL_RATIOS as string[]).includes(value);
/** 描述里一点时长信息都没有时给的可选时长 */
const DEFAULT_DURATIONS = [5, 10, 15];

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
  const resolution = (text.match(/(480p|720p|768p|1080p|2k|4k)/i)?.[1] || "").toLowerCase() as VideoResolution | "";
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
  vendor_id?: number;
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

/**
 * 按模型描述锁定可选参数:分辨率、时长、比例、参考素材、首尾帧。
 * 描述里没提到的就不限制(比例用渠道默认,素材用通用上限);分辨率、时长都没写时按名字或通用值兜底。
 */
export function videoSpec(id: string, description: string, tag = "") {
  const clauses = specClauses(description);
  const listed = specResolutions(clauses).allowed.filter(isResolution);
  const named = (id.match(/(480p|720p|768p|1080p|2k|4k)/i)?.[1] || "").toLowerCase();
  const resolutions = listed.length ? RESOLUTIONS.filter((item) => listed.includes(item))
    : isResolution(named) ? [named] : ["720p" as VideoResolution];
  const preferred = /默认\s*(\d{3,4}p|[24]k)/i.exec(description)?.[1]?.toLowerCase() || "";
  const resolution = isResolution(preferred) && resolutions.includes(preferred) ? preferred : resolutions[0];
  const durations = specDurations(clauses);
  const ratios = specRatios(clauses);
  const defaults = TAG_DEFAULTS[tag] || FALLBACK_DEFAULTS;
  const listedRatios = ratios.allowed.filter(isRatio);
  const media = specMedia(clauses);
  const limits: MediaLimits = media.mentioned
    ? { images: media.images ?? 0, audios: media.audios ?? 0, videos: media.videos ?? 0, total: 0 }
    : { images: 9, audios: 3, videos: 3, total: 0 };
  limits.total = media.total ?? limits.images + limits.audios + limits.videos;
  return {
    resolution,
    resolutions,
    durations: durations.length ? durations : DEFAULT_DURATIONS,
    ratios: (listedRatios.length ? listedRatios : defaults.ratios).filter((ratio) => !ratios.excluded.includes(ratio)),
    limits,
    // 首尾帧要两张图:只收 1 张参考图的模型也做不了
    frames: media.frames && limits.images >= 2,
    face: specFace(description),
  };
}

/** 把 /api/pricing 的返回整理成可选的视频模型,参数限制按模型描述锁定(见 videoSpec)。 */
/** rechargeRate:中转站充值汇率(元/美元),价格换算成用户实际支付的人民币 */
export function toVideoModels(payload: unknown, group = "default", rechargeRate = 1): VideoModel[] {
  const data = (payload as { data?: PricingEntry[]; group_ratio?: Record<string, number> }) || {};
  const groupRatio = Number(data.group_ratio?.[group] || 1);
  const vendors = vendorNames(payload);
  const models: VideoModel[] = [];
  for (const entry of data.data || []) {
    if (!entry.model_name || !entry.supported_endpoint_types?.includes("openai-video")) continue;
    if (entry.enable_groups && !entry.enable_groups.includes(group)) continue;
    const tag = (String(entry.tags || "").split(",")[0] || "").trim().toUpperCase();
    const defaults = TAG_DEFAULTS[tag] || FALLBACK_DEFAULTS;
    const spec = videoSpec(entry.model_name, entry.description || "", tag);
    const perSecond = entry.billing_mode === "tiered_expr" && /u\("seconds"\)/.test(entry.billing_expr || "");
    const perSecondPrice = entry.billing_expr?.match(/u\("seconds"\)\s*\*\s*([\d.]+)/)?.[1];
    models.push({
      type: "video",
      id: entry.model_name,
      tag,
      protocol: arkProtocol(tag, entry.model_name) ? "ark" : "videos",
      description: entry.description || "",
      ...spec,
      billing: perSecond ? "per_second" : "per_request",
      price: Number(perSecond && perSecondPrice ? perSecondPrice : entry.model_price || 0) * groupRatio * rechargeRate,
      promptMin: 1,
      promptMax: defaults.promptMax,
      ...classifyModel(entry.model_name, entry.tags, vendors.get(entry.vendor_id ?? -1)),
    });
  }
  const order = (id: string) => id.replace(/-4k(?=$|-)/i, "-4000p");
  return models.sort((a, b) => order(a.id).localeCompare(order(b.id), "en", { numeric: true }));
}

export function formatPrice(model: Pick<VideoModel, "billing" | "price" | "generic">) {
  if (model.generic) return "价格未知";
  return `¥${model.price.toFixed(2)}/${model.billing === "per_second" ? "秒" : "次"}`;
}

/**
 * 自定义中转站里只知道名字的视频模型:不猜参数,用通用的时长、比例和素材上限,
 * 分辨率取名字里写的(没有就 720p),实际能不能用以中转站的返回为准。
 */
export function genericVideoModel(id: string): VideoModel {
  const resolution = (id.match(/(480p|720p|768p|1080p|2k|4k)/i)?.[1] || "720p").toLowerCase() as VideoResolution;
  return {
    type: "video", id, tag: "", description: "", resolution, resolutions: [resolution], frames: true,
    durations: [5, 10], ratios: ALL_RATIOS,
    limits: { images: 9, audios: 3, videos: 3, total: 12 }, face: "", billing: "per_request", price: 0,
    promptMin: 1, promptMax: FALLBACK_DEFAULTS.promptMax, protocol: arkProtocol("", id) ? "ark" : "videos",
    ...classifyModel(id), generic: true,
  };
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
  const normalized = model.frames ? normalizeReferenceMode(mode) : "references";
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
  // 「智能」在提交时按图片或提示词换成具体比例;只有一种比例的模型没必要选
  const ratio = options.ratio === "adaptive" ? (model.ratios.length > 1 ? "adaptive" : model.ratios[0]) :
    model.ratios.includes(options.ratio) ? options.ratio : model.ratios[0];
  return {
    ...options,
    // 不支持首尾帧的模型回到参考生成
    referenceMode: model.frames ? normalizeReferenceMode(options.referenceMode) : "references",
    // 选过的分辨率这个模型也有就保留,否则用模型的默认分辨率
    resolution: model.resolutions.includes(options.resolution) ? options.resolution : model.resolution,
    duration,
    ratio,
  };
}

const ratioValue = (ratio: string) => {
  const [w, h] = ratio.split(":").map(Number);
  return w / h;
};

// 提示词里的画幅线索,按顺序匹配,命中第一个就用
const RATIO_HINTS: [RegExp, number][] = [
  [/(21|２１)\s*[:：比]\s*9|超宽|宽银幕|宽画幅|电影宽幅|ultra[- ]?wide|anamorphic/i, 21 / 9],
  [/(9|９)\s*[:：比]\s*16|竖屏|竖版|竖构图|竖画幅|手机屏|抖音|快手|小红书|视频号|短视频|vertical|portrait/i, 9 / 16],
  [/(3|３)\s*[:：比]\s*4/, 3 / 4],
  [/(1|１)\s*[:：比]\s*1|正方形|方形|方图|头像|square/i, 1],
  [/(4|４)\s*[:：比]\s*3|老电视|复古电视/, 4 / 3],
  [/(16|１６)\s*[:：比]\s*9|横屏|横版|横构图|landscape|widescreen/i, 16 / 9],
];

/**
 * 「智能」比例:有参考图(首帧/首尾帧/参考图)时取第一张图的宽高比,
 * 否则看提示词里的画幅线索(竖屏、抖音、宽银幕、1:1 等),都没有时用 16:9;
 * 最后就近换成当前模型支持的比例。
 */
export function smartVideoRatio(ratios: readonly VideoRatio[], prompt: string, image?: { width: number; height: number }) {
  const supported = [...ratios];
  if (!supported.length) return "16:9" as VideoRatio;
  const hint = RATIO_HINTS.find(([pattern]) => pattern.test(prompt))?.[1];
  const target = image?.width && image.height ? image.width / image.height : hint ?? 16 / 9;
  return supported.reduce((best, ratio) =>
    Math.abs(Math.log(ratioValue(ratio) / target)) < Math.abs(Math.log(ratioValue(best) / target)) ? ratio : best);
}

/** 提交前的完整校验;返回第一条错误,全部满足时返回空字符串。 */
export function videoRequestError(
  model: VideoModel, prompt: string, options: VideoOptions, attachments: readonly Pick<MediaRef, "kind">[],
) {
  const length = [...prompt.trim()].length;
  if (!length) return "请先填写提示词";
  if (length > model.promptMax) return `提示词最多 ${model.promptMax} 个字`;
  if (!model.resolutions.includes(options.resolution)) {
    return `当前模型支持的分辨率为 ${model.resolutions.map((item) => item.toUpperCase()).join(" / ")}`;
  }
  if (!model.durations.includes(options.duration)) return `当前模型支持的时长为 ${durationSummary(model.durations)}`;
  if (options.ratio === "adaptive" || !model.ratios.includes(options.ratio)) {
    return `当前模型支持的比例为 ${model.ratios.join(" / ")}`;
  }
  const counts = countMedia(attachments);
  const mode = effectiveReferenceMode(options.referenceMode, attachments.length);
  if (mode === "text") return "";
  if (mode === "first_last") {
    if (!model.frames) return "当前模型不支持首尾帧，请改用参考生成";
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
