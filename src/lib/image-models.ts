import { evaluateExpr, parseExpr } from "./billing-expr";
import type { ImageOptions, MediaRef } from "./types";
import { classifyModel, vendorNames } from "./model-catalog";
import { specClauses, specMedia, specRatios, specResolutions, specSizes } from "./model-spec";

export type ImagePrice =
  | { kind: "per_image"; tiers: { name: string; price: number }[]; current: number }
  | { kind: "tokens"; rates: { input: number; output: number; imageInput: number } }
  | { kind: "unknown" };

/**
 * 中转站的生图模型。两种调用方式:
 * - images:new-api /api/pricing 里带 image-generation 端点的模型,走 OpenAI 兼容的 /v1/images/generations,
 *   有参考图时走 /v1/images/edits;尺寸、构图提示与原生图站(image.tangzhi.org)保持一致。
 * - chat:只有对话端点的 Gemini 生图模型(Nano Banana 等),走 /v1/chat/completions,
 *   比例和清晰度通过 extra_body.google.image_config 传,图片在回复内容里返回。
 */
export interface ImageModel {
  type: "image";
  id: string;
  api: "images" | "chat";
  tag: string;
  description: string;
  /** 中转站后台设置的价格(已换算成人民币) */
  price: ImagePrice;
  /** 简短价格,如「¥0.12/张」「按量 · 输出 ¥30/百万」 */
  priceLabel: string;
  /** 完整价格,阶梯价逐档列出,如「1K ¥0.12 · 2K ¥0.24 · 4K ¥0.36（每张）」 */
  priceDetail: string;
  /** 参考图上限(图生图);描述写了「仅文生图」时为 0 */
  maxReferences: number;
  /** 可选分辨率档位(描述里写了 1K / 2K / 4K 的按描述,没写不限制) */
  resolutions: ImageResolution[];
  /** 可选比例;undefined 表示不限制(包括自定义比例) */
  ratios?: string[];
  /** 明确不支持的比例(如 1:4 / 4:1) */
  excludedRatios: string[];
  /** 写死像素尺寸的模型:比例 → [宽, 高] */
  sizes?: Record<string, [number, number]>;
  /** 分辨率档位用 quality 参数指定(1k / 2k / 4k),而不是只看尺寸 */
  qualityParam?: boolean;
  promptMax: number;
  /** 模型选择面板的分组:厂商 → 系列 */
  vendor: string;
  series: string;
  /** 自定义中转站里只知道名字的模型:价格未知 */
  generic?: boolean;
}

export type ImageRatio = ImageOptions["ratio"];
export type ImageResolution = ImageOptions["resolution"];

/** 预设比例;另外支持自定义「宽:高」(如 5:4、2:1),长短边之比不超过 4 */
export const IMAGE_RATIOS = ["1:1", "4:3", "3:4", "16:9", "9:16", "21:9"] as const;
export const MAX_RATIO_SPAN = 4;

/** 解析「宽:高」;两边是 1~999 的整数且长短边之比不超过 4 时返回 [宽, 高] */
export function parseRatio(ratio: unknown): [number, number] | undefined {
  const match = typeof ratio === "string" ? /^(\d{1,3}):(\d{1,3})$/.exec(ratio.trim()) : null;
  if (!match) return undefined;
  const [w, h] = [Number(match[1]), Number(match[2])];
  if (!w || !h || Math.max(w, h) / Math.min(w, h) > MAX_RATIO_SPAN) return undefined;
  return [w, h];
}

export const isPresetRatio = (ratio: string) => (IMAGE_RATIOS as readonly string[]).includes(ratio);
export const IMAGE_RESOLUTIONS: ImageResolution[] = ["1k", "2k", "4k"];
export const IMAGE_BACKGROUNDS: ImageOptions["background"][] = ["auto", "opaque", "transparent"];
export const IMAGE_FORMATS: ImageOptions["format"][] = ["png", "jpeg", "webp"];
export const MAX_IMAGE_REFERENCES = 20;
/** Gemini 生图(Nano Banana)一次最多 14 张参考图 */
export const MAX_CHAT_IMAGE_REFERENCES = 14;
/** Gemini 生图支持的比例;其他比例按最接近的生成 */
export const CHAT_IMAGE_RATIOS = ["1:1", "2:3", "3:2", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9", "21:9"] as const;

/** 把任意「宽:高」换成 Gemini 支持的最接近的比例 */
export function nearestChatRatio(ratio: string) {
  const [w, h] = parseRatio(ratio) || [1, 1];
  const target = Math.log(w / h);
  let best: string = CHAT_IMAGE_RATIOS[0];
  for (const candidate of CHAT_IMAGE_RATIOS) {
    const [cw, ch] = candidate.split(":").map(Number);
    const [bw, bh] = best.split(":").map(Number);
    if (Math.abs(Math.log(cw / ch) - target) < Math.abs(Math.log(bw / bh) - target)) best = candidate;
  }
  return best;
}
const PROMPT_MAX = 6000;

export const BACKGROUND_LABEL: Record<ImageOptions["background"], string> = { auto: "自动", opaque: "不透明", transparent: "透明" };

export const imageDefaults: ImageOptions = { ratio: "1:1", resolution: "1k", background: "auto", format: "png", count: 1 };

// 1K:常用比例的标准尺寸,其他比例长边 1280;2K / 4K:长边 2048 / 4096
// (与生图站一致,也正好对上中转站阶梯计价识别的尺寸)。边长取 16 的倍数。
const SIZES_1K: Record<string, [number, number]> = {
  "1:1": [1024, 1024], "4:3": [960, 720], "3:4": [720, 960], "16:9": [1280, 720], "9:16": [720, 1280],
};

export function imageSize(ratio: ImageRatio, resolution: ImageResolution = "1k", sizes?: Record<string, [number, number]>) {
  const fixed = sizes?.[ratio];
  if (fixed) return { width: fixed[0], height: fixed[1] };
  if (resolution === "1k" && SIZES_1K[ratio]) {
    const [width, height] = SIZES_1K[ratio];
    return { width, height };
  }
  const [w, h] = parseRatio(ratio) || [1, 1];
  const edge = resolution === "4k" ? 4096 : resolution === "2k" ? 2048 : 1280;
  const scale = edge / Math.max(w, h);
  const snap = (value: number) => Math.max(16, Math.round(value / 16) * 16);
  return { width: snap(w * scale), height: snap(h * scale) };
}

/** 某个分辨率档位的每张价格(按尺寸分档的模型);拿不到时返回 undefined */
export function tierPrice(price: ImagePrice, resolution: ImageResolution) {
  if (price.kind !== "per_image") return undefined;
  return price.tiers.find((tier) => tier.name.toLowerCase() === resolution)?.price ?? price.current;
}

/** 在提示词后注明画布比例,上游按这个比例构图(与生图站一致) */
export function withComposition(prompt: string, ratio: ImageRatio) {
  const [w, h] = parseRatio(ratio) || [1, 1];
  const direction = w === h ? "正方形" : w > h ? "横版" : "竖版";
  return `${prompt}\n\n画布要求：宽高比必须为 ${ratio}，${direction}构图。按该比例安排完整画面，文字与主体留在安全区域。画布比例以此设置为准。`;
}

/** 旧数据或不完整的参数补齐为可用值 */
export function fitImageOptions(options?: Partial<ImageOptions> | null): ImageOptions {
  const pick = <T,>(values: readonly T[], value: unknown, fallback: T) =>
    values.includes(value as T) ? value as T : fallback;
  return {
    ratio: parseRatio(options?.ratio) ? String(options?.ratio).trim() : imageDefaults.ratio,
    resolution: pick(IMAGE_RESOLUTIONS, options?.resolution, imageDefaults.resolution),
    background: pick(IMAGE_BACKGROUNDS, options?.background, imageDefaults.background),
    format: pick(IMAGE_FORMATS, options?.format, imageDefaults.format),
    count: Math.min(4, Math.max(1, Math.round(Number(options?.count)) || 1)),
  };
}

const ratioLog = (ratio: string) => {
  const [w, h] = parseRatio(ratio) || [1, 1];
  return Math.log(w / h);
};

/** 最接近的比例(按宽高比的对数距离) */
export function nearestRatio(ratio: string, candidates: readonly string[]) {
  const target = ratioLog(ratio);
  return candidates.reduce((best, item) =>
    Math.abs(ratioLog(item) - target) < Math.abs(ratioLog(best) - target) ? item : best, candidates[0]);
}

/** 把参数收到这个模型支持的范围里(切换模型、读旧记录时调用) */
export function fitImageToModel(model: Pick<ImageModel, "resolutions" | "ratios" | "excludedRatios">, options: ImageOptions): ImageOptions {
  const resolution = model.resolutions.includes(options.resolution) ? options.resolution
    // 不支持当前档位时,取最接近的那档
    : [...model.resolutions].sort((a, b) =>
      Math.abs(IMAGE_RESOLUTIONS.indexOf(a) - IMAGE_RESOLUTIONS.indexOf(options.resolution)) -
      Math.abs(IMAGE_RESOLUTIONS.indexOf(b) - IMAGE_RESOLUTIONS.indexOf(options.resolution)))[0] || options.resolution;
  let ratio = options.ratio;
  if (model.ratios?.length && !model.ratios.includes(ratio)) ratio = nearestRatio(ratio, model.ratios);
  if (model.excludedRatios.includes(ratio)) ratio = imageDefaults.ratio;
  return { ...options, resolution, ratio };
}

export function imageRequestError(model: ImageModel, prompt: string, options: ImageOptions, attachments: readonly Pick<MediaRef, "kind">[]) {
  const length = [...prompt.trim()].length;
  if (!length) return "请先填写提示词";
  if (length > model.promptMax) return `提示词最多 ${model.promptMax} 个字`;
  if (attachments.some((item) => item.kind !== "image")) return "生图只能用图片作为参考";
  if (!model.maxReferences && attachments.length) return "当前模型只支持文生图，不能加参考图";
  if (attachments.length > model.maxReferences) return `最多 ${model.maxReferences} 张参考图`;
  if (!model.resolutions.includes(options.resolution)) {
    return `当前模型支持的分辨率为 ${model.resolutions.map((item) => item.toUpperCase()).join(" / ")}`;
  }
  if (model.ratios?.length && !model.ratios.includes(options.ratio)) return `当前模型支持的比例为 ${model.ratios.join(" / ")}`;
  if (model.excludedRatios.includes(options.ratio)) return `当前模型不支持 ${options.ratio}`;
  // 对话式生图不支持选背景和格式,不拦
  if (model.api === "images" && options.background === "transparent" && options.format === "jpeg") return "透明背景需要 PNG 或 WebP 格式";
  return "";
}

/** 参数摘要,用于卡片:16:9 | 2K | 透明背景 | PNG | 2 张 */
export function imageOptionsSummary(options: ImageOptions) {
  return [
    options.ratio,
    options.resolution.toUpperCase(),
    options.background === "transparent" && "透明背景",
    options.format.toUpperCase(),
    options.count > 1 && `${options.count} 张`,
  ].filter(Boolean) as string[];
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
  model_ratio?: number;
  completion_ratio?: number;
  quota_type?: number;
}

/** 价格一律换算成用户实际支付的人民币:美元价 × 分组倍率 × 充值汇率(中转站「充值价格」,元/美元) */
export interface PriceContext {
  groupRatio: number;
  /** 1 美元额度卖多少元 */
  rechargeRate: number;
}

// 用来探测阶梯的请求尺寸:工作台实际请求的标准尺寸(1K)、2K、4K
const PROBE_SIZES: [string, string][] = [["1K", "1024x1024"], ["2K", "2048x2048"], ["4K", "4096x4096"]];
const TOKEN_VARS = { input: "p", output: "c", imageInput: "img" } as const;

/** 每张固定价(可能按尺寸分档),或按 token 计费的每百万单价;都是人民币 */
export function imagePricing(entry: PricingEntry, context: PriceContext): ImagePrice {
  const scale = (usd: number) => Math.round(usd * context.groupRatio * context.rechargeRate * 10_000) / 10_000;
  if (entry.billing_mode === "tiered_expr" && entry.billing_expr) {
    try {
      const root = parseExpr(entry.billing_expr);
      const tiers: { name: string; price: number }[] = [];
      for (const [label, size] of PROBE_SIZES) {
        const result = evaluateExpr(root, { vars: { image_count: 1, n: 1 }, params: { size, quality: label.toLowerCase() } });
        if (result.micros <= 0) continue;
        const name = result.tier && result.tier !== "standard" ? result.tier : label;
        const price = scale(result.micros / 1e6);
        if (!tiers.some((tier) => tier.name === name && tier.price === price)) tiers.push({ name, price });
      }
      if (tiers.length) {
        // 名字相同的档只保留一个;只有一档时不标尺寸
        return { kind: "per_image", tiers: tiers.length > 1 ? tiers : [{ name: "", price: tiers[0].price }], current: tiers[0].price };
      }
      const rate = (variable: string) => scale(evaluateExpr(root, { vars: { [variable]: 1 } }).micros);
      const rates = { input: rate(TOKEN_VARS.input), output: rate(TOKEN_VARS.output), imageInput: rate(TOKEN_VARS.imageInput) };
      if (rates.input || rates.output || rates.imageInput) return { kind: "tokens", rates };
    } catch {
      // 表达式看不懂时退回下面的普通计价
    }
  }
  if (entry.quota_type === 1 && Number(entry.model_price) > 0) {
    const price = scale(Number(entry.model_price));
    return { kind: "per_image", tiers: [{ name: "", price }], current: price };
  }
  if (Number(entry.model_ratio) > 0) {
    // new-api 倍率:1 = 每百万 token 2 美元;输出再乘补全倍率
    const input = scale(Number(entry.model_ratio) * 2);
    return { kind: "tokens", rates: { input, output: scale(Number(entry.model_ratio) * 2 * Number(entry.completion_ratio || 1)), imageInput: 0 } };
  }
  return { kind: "unknown" };
}

export const yuan = (value: number) => `¥${value < 0.1 ? value.toFixed(3).replace(/0$/, "") : value.toFixed(2)}`;

/** 简短价格:下拉框和顶栏用,标的是工作台实际请求的那一档 */
export function priceLabel(price: ImagePrice) {
  if (price.kind === "per_image") return `${yuan(price.current)}/张`;
  if (price.kind === "tokens") return `按量 · 输出 ${yuan(price.rates.output)}/百万`;
  return "按量计费";
}

/** 完整价格:设置页用,阶梯价逐档列出 */
export function priceDetail(price: ImagePrice) {
  if (price.kind === "per_image") {
    return price.tiers.length > 1
      ? `${price.tiers.map((tier) => `${tier.name} ${yuan(tier.price)}`).join(" · ")}（每张）`
      : `${yuan(price.current)}/张`;
  }
  if (price.kind === "tokens") {
    const { input, output, imageInput } = price.rates;
    return [input && `输入 ${yuan(input)}`, output && `输出 ${yuan(output)}`, imageInput && `图片输入 ${yuan(imageInput)}`]
      .filter(Boolean).join(" · ") + "（每百万 tokens）";
  }
  return "按量计费";
}

// 只有对话端点、但其实是生图的模型:Nano Banana、gemini-*-image、Imagen,或按张计费(表达式里有 image_count)的
const CHAT_IMAGE_NAME = /nano[\s_-]*banana|gemini[\w.-]*-image|imagen/i;

/** 走对话接口出图的模型(Nano Banana 等):没有 image-generation 端点,但有 openai 对话端点 */
export function isChatImageModel(entry: PricingEntry) {
  const types = entry.supported_endpoint_types || [];
  if (!entry.model_name || types.includes("image-generation") || !types.includes("openai")) return false;
  return CHAT_IMAGE_NAME.test(entry.model_name) || /\bimage_count\b/.test(entry.billing_expr || "");
}

/** 按尺寸找最接近的预设比例名(1792x1024 → 16:9) */
function sizeRatio(width: number, height: number) {
  const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);
  const divisor = gcd(width, height);
  const exact = `${width / divisor}:${height / divisor}`;
  return isPresetRatio(exact) ? exact : nearestRatio(exact, IMAGE_RATIOS);
}

/**
 * 按模型描述锁定可选参数:分辨率档位、比例、写死的尺寸、参考图上限。没写到的不限制。
 * 例:「1K / 2K」只开放 1K、2K;「无2k-4k」只剩 1K;「size 1024x1024 / 1792x1024 / 1024x1792」只开放 1:1 / 16:9 / 9:16;
 * 「不支持 1:4 / 4:1」排除这两个比例;「仅文生图」不能加参考图。
 */
export function imageSpec(description: string, chat: boolean) {
  const clauses = specClauses(description);
  const tiers = specResolutions(clauses);
  const listed = IMAGE_RESOLUTIONS.filter((item) => tiers.allowed.includes(item));
  const open = IMAGE_RESOLUTIONS.filter((item) => !tiers.excluded.includes(item));
  const pixelSizes = specSizes(clauses);
  let sizes: Record<string, [number, number]> | undefined;
  for (const [width, height] of pixelSizes) {
    const ratio = sizeRatio(width, height);
    sizes ??= {};
    sizes[ratio] ??= [width, height];
  }
  const ratios = specRatios(clauses);
  const listedRatios = ratios.allowed.filter((ratio) => parseRatio(ratio));
  const sizeEdge = pixelSizes.length ? Math.max(...pixelSizes[0]) : 0;
  const resolutions: ImageResolution[] = listed.length ? listed
    : sizes ? [sizeEdge > 3000 ? "4k" : sizeEdge > 1600 ? "2k" : "1k"]
      : open.length ? open : ["1k"];
  const media = specMedia(clauses);
  const limit = chat ? MAX_CHAT_IMAGE_REFERENCES : MAX_IMAGE_REFERENCES;
  return {
    resolutions,
    ratios: sizes ? Object.keys(sizes) : listedRatios.length ? listedRatios : undefined,
    excludedRatios: ratios.excluded,
    ...(sizes ? { sizes } : {}),
    maxReferences: Math.min(limit, media.images ?? limit),
  };
}

/** 从 /api/pricing 里挑出生图模型 */
export function toImageModels(payload: unknown, group: string | null = "default", rechargeRate = 1): ImageModel[] {
  const data = (payload as { data?: PricingEntry[]; group_ratio?: Record<string, number> }) || {};
  const context: PriceContext = { groupRatio: Number((group && data.group_ratio?.[group]) || 1), rechargeRate };
  const vendors = vendorNames(payload);
  const models: ImageModel[] = [];
  for (const entry of data.data || []) {
    const chat = isChatImageModel(entry);
    if (!entry.model_name || (!chat && !entry.supported_endpoint_types?.includes("image-generation"))) continue;
    if (group && entry.enable_groups && !entry.enable_groups.includes(group)) continue;
    const price = imagePricing(entry, context);
    models.push({
      type: "image",
      id: entry.model_name,
      api: chat ? "chat" : "images",
      tag: (String(entry.tags || "").split(",")[0] || "").trim(),
      description: entry.description || "",
      price,
      priceLabel: priceLabel(price),
      priceDetail: priceDetail(price),
      promptMax: PROMPT_MAX,
      ...imageSpec(entry.description || "", chat),
      ...(/param\("quality"\)/.test(entry.billing_expr || "") || /quality\s*(?:指定|1k|\()/i.test(entry.description || "")
        ? { qualityParam: true } : {}),
      ...classifyModel(entry.model_name, entry.tags, vendors.get(entry.vendor_id ?? -1)),
    });
  }
  return models.sort((a, b) => a.id.localeCompare(b.id, "en", { numeric: true }));
}

/** 名字像生图模型(没有端点信息的中转站用) */
export const IMAGE_MODEL_NAME = /image|banana|imagen|flux|seedream|dall-?e|midjourney|(?:^|[-_])mj[-_]|recraft|ideogram|kolors/i;

/** 自定义中转站里只知道名字的生图模型:Gemini 一类走对话接口,其余走 /v1/images,价格未知 */
export function genericImageModel(id: string, chatOnly = false): ImageModel {
  const chat = chatOnly || CHAT_IMAGE_NAME.test(id);
  const price: ImagePrice = { kind: "unknown" };
  return {
    type: "image", id, api: chat ? "chat" : "images", tag: "", description: "", price,
    priceLabel: "价格未知", priceDetail: "价格未知",
    maxReferences: chat ? MAX_CHAT_IMAGE_REFERENCES : MAX_IMAGE_REFERENCES, promptMax: PROMPT_MAX,
    resolutions: IMAGE_RESOLUTIONS, excludedRatios: [],
    ...classifyModel(id), generic: true,
  };
}

/** 名字是不是 Gemini 一类只能走对话接口的生图模型 */
export const isChatImageName = (id: string) => CHAT_IMAGE_NAME.test(id);
