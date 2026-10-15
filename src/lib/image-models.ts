import type { ImageOptions, MediaRef } from "./types";

/**
 * 中转站的生图模型(new-api /api/pricing 里带 image-generation 端点的模型)。
 * 请求走 OpenAI 兼容的 /v1/images/generations;有参考图时走 /v1/images/edits。
 * 尺寸、构图提示与原生图站(image.tangzhi.org)保持一致。
 */
export interface ImageModel {
  type: "image";
  id: string;
  tag: string;
  description: string;
  /** 价格说明:按次计费的显示单价,按 token 计费的显示「按量计费」 */
  priceLabel: string;
  /** 参考图上限(图生图) */
  maxReferences: number;
  promptMax: number;
}

export type ImageRatio = ImageOptions["ratio"];

export const IMAGE_RATIOS: ImageRatio[] = ["1:1", "4:3", "3:4", "16:9", "9:16"];
export const IMAGE_BACKGROUNDS: ImageOptions["background"][] = ["auto", "opaque", "transparent"];
export const IMAGE_FORMATS: ImageOptions["format"][] = ["png", "jpeg", "webp"];
export const MAX_IMAGE_REFERENCES = 4;
const PROMPT_MAX = 6000;

export const BACKGROUND_LABEL: Record<ImageOptions["background"], string> = { auto: "自动", opaque: "不透明", transparent: "透明" };

export const imageDefaults: ImageOptions = { ratio: "1:1", background: "auto", format: "png", count: 1 };

// 按比例请求标准尺寸(与生图站 720P 档一致);按尺寸分档计费的模型也只按最低一档收费
const SIZES: Record<ImageRatio, [number, number]> = {
  "1:1": [1024, 1024], "4:3": [960, 720], "3:4": [720, 960], "16:9": [1280, 720], "9:16": [720, 1280],
};

export function imageSize(ratio: ImageRatio) {
  const [width, height] = SIZES[ratio];
  return { width, height };
}

/** 在提示词后注明画布比例,上游按这个比例构图(与生图站一致) */
export function withComposition(prompt: string, ratio: ImageRatio) {
  const [w, h] = ratio.split(":").map(Number);
  const direction = w === h ? "正方形" : w > h ? "横版" : "竖版";
  return `${prompt}\n\n画布要求：宽高比必须为 ${ratio}，${direction}构图。按该比例安排完整画面，文字与主体留在安全区域。画布比例以此设置为准。`;
}

/** 旧数据或不完整的参数补齐为可用值 */
export function fitImageOptions(options?: Partial<ImageOptions> | null): ImageOptions {
  const pick = <T,>(values: readonly T[], value: unknown, fallback: T) =>
    values.includes(value as T) ? value as T : fallback;
  return {
    ratio: pick(IMAGE_RATIOS, options?.ratio, imageDefaults.ratio),
    background: pick(IMAGE_BACKGROUNDS, options?.background, imageDefaults.background),
    format: pick(IMAGE_FORMATS, options?.format, imageDefaults.format),
    count: Math.min(4, Math.max(1, Math.round(Number(options?.count)) || 1)),
  };
}

export function imageRequestError(model: ImageModel, prompt: string, options: ImageOptions, attachments: readonly Pick<MediaRef, "kind">[]) {
  const length = [...prompt.trim()].length;
  if (!length) return "请先填写提示词";
  if (length > model.promptMax) return `提示词最多 ${model.promptMax} 个字`;
  if (attachments.some((item) => item.kind !== "image")) return "生图只能用图片作为参考";
  if (attachments.length > model.maxReferences) return `最多 ${model.maxReferences} 张参考图`;
  if (options.background === "transparent" && options.format === "jpeg") return "透明背景需要 PNG 或 WebP 格式";
  return "";
}

/** 参数摘要,用于卡片:16:9 | 透明背景 | PNG | 2 张 */
export function imageOptionsSummary(options: ImageOptions) {
  return [
    options.ratio,
    options.background === "transparent" && "透明背景",
    options.format.toUpperCase(),
    options.count > 1 && `${options.count} 张`,
  ].filter(Boolean) as string[];
}

interface PricingEntry {
  model_name?: string;
  description?: string | null;
  tags?: string | null;
  supported_endpoint_types?: string[];
  enable_groups?: string[];
  billing_mode?: string;
  model_price?: number;
  quota_type?: number;
}

/** 从 /api/pricing 里挑出生图模型 */
export function toImageModels(payload: unknown, group = "default"): ImageModel[] {
  const data = (payload as { data?: PricingEntry[]; group_ratio?: Record<string, number> }) || {};
  const groupRatio = Number(data.group_ratio?.[group] || 1);
  const models: ImageModel[] = [];
  for (const entry of data.data || []) {
    if (!entry.model_name || !entry.supported_endpoint_types?.includes("image-generation")) continue;
    if (entry.enable_groups && !entry.enable_groups.includes(group)) continue;
    const price = Number(entry.model_price || 0) * groupRatio;
    const perCall = entry.quota_type === 1 && price > 0;
    models.push({
      type: "image",
      id: entry.model_name,
      tag: (String(entry.tags || "").split(",")[0] || "").trim(),
      description: entry.description || "",
      // 按尺寸分档计价(tiered_expr)时,标的是最低一档
      priceLabel: perCall ? `¥${price.toFixed(2)}/张${entry.billing_mode === "tiered_expr" ? "起" : ""}` : "按量计费",
      maxReferences: MAX_IMAGE_REFERENCES,
      promptMax: PROMPT_MAX,
    });
  }
  return models.sort((a, b) => a.id.localeCompare(b.id, "en", { numeric: true }));
}
