import { createHash } from "node:crypto";
import { genericVideoModel, toVideoModels, type VideoModel } from "./tangzhi";
import { genericImageModel, IMAGE_MODEL_NAME, isChatImageName, toImageModels, type ImageModel } from "./image-models";
import {
  assistCandidates, assistSystemPrompt, cleanAssistOutput, compareModelsNewestFirst, isChatModelEntry, toTextModels,
  type AssistKind,
} from "./prompt-assist";
import { DEFAULT_RELAY, publicFetch, relayFetch, relayHost, type Relay } from "./relay";

export type CatalogModel = VideoModel | ImageModel;

const CATALOG_TTL = 60_000;
const MAX_CATALOGS = 50;
// 每个中转站地址各自缓存
const catalogs = new Map<string, {
  at: number; videos: VideoModel[]; images: ImageModel[]; texts: string[];
  /** 不看分组解析出的视频 / 生图模型(自定义中转站按 Key 的模型列表取用,分组名可能都不叫 default) */
  anyGroup: CatalogModel[];
}>();

/** 读取中转站公开定价接口(new-api 的 /api/pricing)里的视频、生图模型(1 分钟缓存,失败时沿用上次结果)。 */
async function catalog(relay: Relay) {
  const cached = catalogs.get(relay.base);
  if (cached && Date.now() - cached.at < CATALOG_TTL) return cached;
  try {
    const response = await relayFetch(relay, "/api/pricing", { signal: AbortSignal.timeout(15_000) });
    if (!response.ok) throw new Error(`模型列表返回 ${response.status}`);
    const payload = await response.json().catch(() => {
      throw new Error("模型列表格式不正确（需要 new-api 兼容的中转站）");
    });
    const rate = await rechargeRate(relay);
    const entry = {
      at: Date.now(), videos: toVideoModels(payload, "default", rate), images: toImageModels(payload, "default", rate),
      // 文本模型不看分组:Key 在哪个分组就能用哪些,见 textModelsFor
      texts: toTextModels(payload, null),
      anyGroup: relay.custom ? [...toVideoModels(payload, null, rate), ...toImageModels(payload, null, rate)] : [],
    };
    // 自定义中转站的分组可能都不叫 default(视频、生图一个都对不上),对话模型照样要留着
    if (!entry.videos.length && !entry.images.length && !entry.anyGroup.length && !entry.texts.length) throw new Error("中转站暂无可用的模型");
    if (catalogs.size >= MAX_CATALOGS && !catalogs.has(relay.base)) catalogs.delete(catalogs.keys().next().value as string);
    catalogs.set(relay.base, entry);
    return entry;
  } catch (error) {
    if (cached) return cached;
    throw new Error(`无法获取中转站模型：${(error as Error).message}`);
  }
}

/**
 * 中转站的充值汇率(new-api /api/status 的 price:1 美元额度卖多少元)。
 * 计费表达式和模型价格都以美元计,乘上它就是用户实际支付的人民币;读不到时按 1。
 */
async function rechargeRate(relay: Relay) {
  try {
    const response = await relayFetch(relay, "/api/status", { signal: AbortSignal.timeout(10_000) });
    const data = await response.json() as { data?: { price?: unknown } };
    const price = Number(data.data?.price);
    return Number.isFinite(price) && price > 0 ? price : 1;
  } catch {
    return 1;
  }
}

export async function videoModels(relay: Relay = DEFAULT_RELAY): Promise<VideoModel[]> {
  return (await catalog(relay)).videos;
}

// 没有端点信息时按名字认视频模型
const VIDEO_MODEL_NAME = /veo|sora|kling|hailuo|seedance|(?:^|[-_])sd-\d|(?:^|[-_])wan[\d.]*[-_]?(?:t2v|i2v)|vidu|video|runway|pika|luma|pixverse/i;

const VIDEO_TYPES = new Set(["openai-video", "video-generation"]);
const IMAGE_TYPES = new Set(["image-generation", "image-edit", "openai-image"]);

export type KeyModelKind = "video" | "image" | "chat" | "other";

/**
 * Key 的 /v1/models 里一项是什么模型:new-api 会给端点类型,按类型认;没有类型时按名字认。
 * 同一个 Key 往往视频、生图、对话模型都有,模型列表和设置页的「验证」都靠它分开。
 */
export function keyModelKind(id: string, types: readonly string[]): KeyModelKind {
  if (types.some((type) => VIDEO_TYPES.has(type)) || (!types.length && VIDEO_MODEL_NAME.test(id))) return "video";
  if (types.some((type) => IMAGE_TYPES.has(type)) || isChatImageName(id) || (!types.length && IMAGE_MODEL_NAME.test(id))) return "image";
  if (isChatModelEntry(id, types)) return "chat";
  return "other";
}

/**
 * 自定义中转站:模型以这个 Key 的 /v1/models 为准(能用哪些就列哪些)。
 * 中转站的 /api/pricing 里按本站格式写了描述的,沿用解析出的参数和价格;
 * 其余只知道名字的,按端点类型(new-api 会给)或名字认出视频 / 生图模型,参数用通用值,价格未知。
 */
async function customRelayModels(relay: Relay, apiKey: string): Promise<CatalogModel[]> {
  const parsed = await catalog(relay).catch(() => undefined);
  const list = await keyModelList(apiKey, relay);
  if (!list) {
    if (parsed) return parsed.anyGroup.length ? parsed.anyGroup : [...parsed.videos, ...parsed.images];
    throw new Error("无法获取中转站模型：请检查中转站地址和 API Key");
  }
  // 定价表里写了描述的沿用解析出的参数和价格(不看分组;价格按原价)
  const known = new Map<string, CatalogModel>(
    [...(parsed?.anyGroup || []), ...(parsed?.videos || []), ...(parsed?.images || [])].map((model) => [model.id, model]),
  );
  const models: CatalogModel[] = [];
  for (const { id, types } of list) {
    const found = known.get(id);
    if (found) { models.push(found); continue; }
    const kind = keyModelKind(id, types);
    if (kind === "video") models.push(genericVideoModel(id));
    // 只能走对话接口出图的(nano-banana 这类)标记为对话生图
    else if (kind === "image") models.push(genericImageModel(id, !types.some((type) => IMAGE_TYPES.has(type)) && isChatImageName(id)));
  }
  if (!models.length) throw new Error("这个 Key 在中转站上没有可用的视频或生图模型");
  return [...models.filter((model) => model.type === "video"), ...models.filter((model) => model.type === "image")];
}

/**
 * 视频模型在前,生图模型在后。视频和图片可以用不同的 Key:
 * 自定义中转站的视频模型按视频 Key 的 /v1/models 列,生图模型按图片 Key 的列。
 */
export async function catalogModels(relay: Relay = DEFAULT_RELAY, apiKey?: string, imageKey = apiKey): Promise<CatalogModel[]> {
  if (relay.custom && apiKey) {
    if (!imageKey || imageKey === apiKey) return customRelayModels(relay, apiKey);
    const [fromVideoKey, fromImageKey] = await Promise.all([
      customRelayModels(relay, apiKey).catch(() => [] as CatalogModel[]),
      customRelayModels(relay, imageKey).catch(() => [] as CatalogModel[]),
    ]);
    const models = [...fromVideoKey.filter((model) => model.type === "video"), ...fromImageKey.filter((model) => model.type === "image")];
    if (!models.length) throw new Error("视频和图片的 Key 在中转站上都没有可用的模型");
    return models;
  }
  const { videos, images } = await catalog(relay);
  return [...videos, ...images];
}

export async function findModel(id: string, relay: Relay = DEFAULT_RELAY, apiKey?: string, imageKey = apiKey) {
  const model = (await catalogModels(relay, apiKey, imageKey)).find((item) => item.id === id);
  if (!model) throw new Error("所选模型已下线，请重新选择模型");
  return model;
}

export async function findVideoModel(id: string, relay: Relay = DEFAULT_RELAY) {
  const model = (await videoModels(relay)).find((item) => item.id === id);
  if (!model) throw new Error("所选模型已下线，请重新选择模型");
  return model;
}

/** 站点对外地址:中转站需要从公网拉取参考素材。 */
export function publicOrigin(request: Request) {
  const configured = process.env.MOTE_PUBLIC_URL?.replace(/\/+$/, "");
  if (configured) return configured;
  const host = request.headers.get("x-forwarded-host") || request.headers.get("host");
  const proto = request.headers.get("x-forwarded-proto")?.split(",")[0].trim() || "https";
  return host ? `${proto}://${host}` : new URL(request.url).origin;
}

/** 中转站错误可能是 {error:{message}} 或 {message:"<嵌套 JSON>"},取最里层的可读信息。 */
export function upstreamMessage(data: unknown, status: number): string {
  let current: unknown = data;
  for (let depth = 0; depth < 5; depth++) {
    if (typeof current === "string") {
      const text: string = current;
      try { current = JSON.parse(text); continue; } catch { return text || `中转站返回 ${status}`; }
    }
    if (!current || typeof current !== "object") break;
    const item = current as { error?: unknown; message?: unknown };
    if (item.error && typeof item.error === "object") { current = item.error; continue; }
    if (typeof item.error === "string" && item.error) { current = item.error; continue; }
    if (typeof item.message === "string" && item.message) { current = item.message; continue; }
    break;
  }
  return `中转站返回 ${status}`;
}

/** 把中转站的扣费失败提示换成用户看得懂的话。 */
export function friendlyMessage(message: string, host = relayHost(DEFAULT_RELAY)) {
  if (!/预扣费额度失败|额度不足|余额不足|insufficient/i.test(message)) return message;
  const left = message.match(/剩余额度[:：]\s*[^\d-]*([\d.]+)/)?.[1];
  const need = message.match(/需要预扣费额度[:：]\s*[^\d-]*([\d.]+)/)?.[1];
  const detail = left && need ? `本次需预扣 ${Number(need).toFixed(2)}，当前剩余 ${Number(left).toFixed(2)}。` : "";
  return `中转站余额不足：${detail}请到 ${host} 充值，或改用更便宜的模型、更短时长或更小尺寸。`;
}

async function call(relay: Relay, apiKey: string, path: string, init: RequestInit = {}) {
  const response = await relayFetch(relay, path, {
    ...init,
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json", ...init.headers },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401) throw new Error("API Key 无效或已过期，请在设置中检查");
    throw new Error(friendlyMessage(upstreamMessage(data, response.status), relayHost(relay)));
  }
  return data as Record<string, unknown>;
}

export async function submitVideoTask(
  apiKey: string, body: Record<string, unknown>, signal?: AbortSignal, relay: Relay = DEFAULT_RELAY,
) {
  const data = await call(relay, apiKey, "/v1/videos", { method: "POST", body: JSON.stringify(body), signal });
  const id = data.id || data.task_id;
  if (typeof id !== "string" || !id) throw new Error("中转站未返回任务 ID");
  return id;
}

export interface TaskResult {
  status: "processing" | "succeeded" | "failed";
  progress?: number;
  error?: string;
  /** 中转站记录的受理 → 结束用时(毫秒),没有时间戳时为空 */
  elapsedMs?: number;
}

/** 中转站返回的 created_at / completed_at 是 Unix 秒(个别实现给毫秒) */
export function taskElapsedMs(data: Record<string, unknown>) {
  const toMs = (value: unknown) => {
    const number = Number(value);
    if (!Number.isFinite(number) || number <= 0) return undefined;
    return number > 1e12 ? number : number * 1000;
  };
  const start = toMs(data.created_at);
  const end = toMs(data.completed_at);
  return start !== undefined && end !== undefined && end >= start ? end - start : undefined;
}

export async function queryVideoTask(apiKey: string, taskId: string, relay: Relay = DEFAULT_RELAY): Promise<TaskResult> {
  const data = await call(relay, apiKey, `/v1/videos/${encodeURIComponent(taskId)}`);
  const status = String(data.status || "").toLowerCase();
  const elapsedMs = taskElapsedMs(data);
  if (["completed", "succeeded", "success"].includes(status)) return { status: "succeeded", elapsedMs };
  if (["failed", "cancelled", "canceled", "expired"].includes(status)) {
    return { status: "failed", error: upstreamMessage(data, 200).replace(/^中转站返回 200$/, "视频生成失败"), elapsedMs };
  }
  return { status: "processing", progress: Number(data.progress) || 0 };
}

/** 完成后的视频需要带鉴权从 /content 下载。 */
export async function downloadVideo(apiKey: string, taskId: string, relay: Relay = DEFAULT_RELAY) {
  const response = await relayFetch(relay, `/v1/videos/${encodeURIComponent(taskId)}/content`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!response.ok) {
    throw new Error(upstreamMessage(await response.json().catch(() => ({})), response.status));
  }
  return new Uint8Array(await response.arrayBuffer());
}

const PREFIX = "tz.";

export function encodeTaskId(upstreamId: string) {
  return PREFIX + upstreamId;
}

/** 只有本版本提交的任务可以查询;旧供应商留下的任务返回 undefined。 */
export function decodeTaskId(value: string) {
  return value.startsWith(PREFIX) ? value.slice(PREFIX.length) : undefined;
}

// ---- 生图:OpenAI 兼容的 /v1/images/generations 与 /v1/images/edits(同步返回,最长等 5 分钟)

export interface ImageResult {
  bytes: Uint8Array;
  mimeType: string;
}

async function imageResponse(response: Response, relay: Relay): Promise<ImageResult> {
  const data = await response.json().catch(() => ({})) as { data?: Array<{ b64_json?: string; url?: string; mime_type?: string }> };
  if (!response.ok) {
    if (response.status === 401) throw new Error("API Key 无效或已过期，请在设置中检查");
    throw new Error(friendlyMessage(upstreamMessage(data, response.status), relayHost(relay)));
  }
  const item = data.data?.find((entry) => entry.b64_json || entry.url);
  if (!item) throw new Error("中转站没有返回图片");
  if (item.b64_json) {
    return { bytes: new Uint8Array(Buffer.from(item.b64_json, "base64")), mimeType: item.mime_type || "" };
  }
  const download = await publicFetch(item.url as string);
  const type = download.headers.get("content-type") || "";
  if (!download.ok || !type.startsWith("image/")) throw new Error("无法读取中转站返回的图片");
  const bytes = new Uint8Array(await download.arrayBuffer());
  if (bytes.byteLength > 50 * 1024 * 1024) throw new Error("图片超过 50MB 限制");
  return { bytes, mimeType: type };
}

// 工作台自己的任务 ID(img.…):中转站把它记进使用日志,生图日志里能按它对上这次生成
const taskHeader = (taskId?: string): Record<string, string> => (taskId ? { "X-Client-Task-Id": taskId } : {});

export async function generateImage(apiKey: string, body: Record<string, unknown>, relay: Relay = DEFAULT_RELAY, taskId?: string) {
  const response = await relayFetch(relay, "/v1/images/generations", {
    method: "POST", body: JSON.stringify(body), signal: AbortSignal.timeout(300_000),
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json", ...taskHeader(taskId) },
  });
  return imageResponse(response, relay);
}

/**
 * 对话式生图(Nano Banana 等 Gemini 生图模型):/v1/chat/completions,参考图作为 image_url 一起发。
 * 比例和清晰度放在 extra_body.google.image_config;顶层 size(1K / 2K / 4K)给中转站的阶梯计价识别档位。
 * 图片在回复内容里,形如 ![image](data:image/jpeg;base64,…) 或图片链接。
 */
export async function chatImage(
  apiKey: string,
  request: { model: string; prompt: string; aspectRatio: string; imageSize: string; references: { bytes: Uint8Array; mimeType: string }[] },
  relay: Relay = DEFAULT_RELAY,
  taskId?: string,
): Promise<ImageResult> {
  const content = [
    { type: "text", text: request.prompt },
    ...request.references.map((item) => ({
      type: "image_url",
      image_url: { url: `data:${item.mimeType || "image/png"};base64,${Buffer.from(item.bytes).toString("base64")}` },
    })),
  ];
  const data = await call(relay, apiKey, "/v1/chat/completions", {
    method: "POST", signal: AbortSignal.timeout(300_000), headers: taskHeader(taskId),
    body: JSON.stringify({
      model: request.model,
      messages: [{ role: "user", content }],
      size: request.imageSize,
      extra_body: { google: { image_config: { aspect_ratio: request.aspectRatio, image_size: request.imageSize } } },
    }),
  });
  return chatImageResult(data);
}

/** 从对话回复里取出第一张图:data URL、图片链接,或 message.images 里的图 */
export async function chatImageResult(data: Record<string, unknown>): Promise<ImageResult> {
  const message = (data.choices as Array<{ message?: { content?: unknown; images?: Array<{ image_url?: { url?: string } }> } }> | undefined)?.[0]?.message;
  const content = typeof message?.content === "string" ? message.content
    : Array.isArray(message?.content) ? (message.content as Array<{ text?: string; image_url?: { url?: string } }>)
      .map((part) => part.image_url?.url ? `![image](${part.image_url.url})` : part.text || "").join("\n") : "";
  const url = message?.images?.find((item) => item.image_url?.url)?.image_url?.url
    || content.match(/!\[[^\]]*\]\((data:image\/[\w+.-]+;base64,[A-Za-z0-9+/=]+|https?:\/\/[^\s)]+)\)/)?.[1]
    || content.match(/data:image\/[\w+.-]+;base64,[A-Za-z0-9+/=]+/)?.[0];
  if (!url) {
    const text = content.trim().slice(0, 200);
    throw new Error(text ? `模型没有返回图片：${text}` : "中转站没有返回图片");
  }
  const inline = url.match(/^data:(image\/[\w+.-]+);base64,(.+)$/);
  if (inline) return { bytes: new Uint8Array(Buffer.from(inline[2], "base64")), mimeType: inline[1] };
  const download = await publicFetch(url);
  const type = download.headers.get("content-type") || "";
  if (!download.ok || !type.startsWith("image/")) throw new Error("无法读取中转站返回的图片");
  const bytes = new Uint8Array(await download.arrayBuffer());
  if (bytes.byteLength > 50 * 1024 * 1024) throw new Error("图片超过 50MB 限制");
  return { bytes, mimeType: type };
}

export async function editImage(apiKey: string, form: FormData, relay: Relay = DEFAULT_RELAY, taskId?: string) {
  const response = await relayFetch(relay, "/v1/images/edits", {
    method: "POST", body: form, signal: AbortSignal.timeout(300_000),
    headers: { Authorization: `Bearer ${apiKey}`, ...taskHeader(taskId) },
  });
  return imageResponse(response, relay);
}

// ---- 提示词优化:用中转站的对话模型扩写提示词

// 每个中转站最近一次优化成功用的模型:中转站个别模型临时不可用时,下次直接用能用的
const workingAssistModel = new Map<string, string>();
const MAX_ASSIST_ATTEMPTS = 6;

// 每个 Key 能用的模型(中转站 /v1/models 按 Key 所在分组返回;new-api 还会给出端点类型),1 分钟缓存
type KeyModel = { id: string; types: string[] };
const keyModels = new Map<string, { at: number; list: KeyModel[] }>();

async function keyModelList(apiKey: string, relay: Relay) {
  const cacheKey = `${relay.base}|${createHash("sha256").update(apiKey).digest("hex")}`;
  const cached = keyModels.get(cacheKey);
  if (cached && Date.now() - cached.at < CATALOG_TTL) return cached.list;
  try {
    const data = await call(relay, apiKey, "/v1/models", { signal: AbortSignal.timeout(15_000) });
    const raw = Array.isArray(data.data) ? data.data as Array<{ id?: unknown; supported_endpoint_types?: unknown }> : [];
    const list = raw
      .filter((item): item is { id: string; supported_endpoint_types?: unknown } => typeof item.id === "string" && Boolean(item.id))
      .map((item) => ({
        id: item.id,
        types: Array.isArray(item.supported_endpoint_types)
          ? item.supported_endpoint_types.filter((type): type is string => typeof type === "string") : [],
      }));
    if (keyModels.size >= MAX_CATALOGS * 4 && !keyModels.has(cacheKey)) keyModels.delete(keyModels.keys().next().value as string);
    keyModels.set(cacheKey, { at: Date.now(), list });
    return list;
  } catch {
    // Key 无效等情况由真正调用时报错,这里先列出全部
    return cached?.list;
  }
}

/**
 * 这个 Key 能用的对话模型:定价表里的对话模型 ∩ Key 的 /v1/models;
 * 自定义中转站再加上 Key 的模型列表里认得出是对话模型的(定价表可能读不到或没写)。
 * 没给 Key 或读不到 Key 的模型列表时,列出定价表里全部对话模型。
 */
async function textModelsFor(relay: Relay, apiKey?: string) {
  const parsed = await catalog(relay).catch((error) => {
    if (!relay.custom) throw error;
    return undefined;
  });
  const texts = parsed?.texts || [];
  const list = apiKey ? await keyModelList(apiKey, relay) : undefined;
  if (!list) return texts;
  const known = new Set(texts);
  const ids = list.filter(({ id, types }) => known.has(id) || (relay.custom && isChatModelEntry(id, types))).map((item) => item.id);
  return [...new Set(ids)].sort(compareModelsNewestFirst);
}

/** 设置页「提示词优化模型」的选项:这个 Key 能用的对话模型,以及「自动」现在会先用哪个 */
export async function assistModelOptions(relay: Relay = DEFAULT_RELAY, apiKey?: string) {
  const texts = await textModelsFor(relay, apiKey);
  const remembered = workingAssistModel.get(relay.base);
  return {
    models: texts,
    // 最近一次成功的模型优先
    auto: remembered && texts.includes(remembered) ? remembered : assistCandidates(texts)[0],
  };
}

async function completeOnce(apiKey: string, relay: Relay, model: string, prompt: string, kind: AssistKind) {
  const data = await call(relay, apiKey, "/v1/chat/completions", {
    method: "POST", signal: AbortSignal.timeout(90_000),
    body: JSON.stringify({
      model,
      messages: [{ role: "system", content: assistSystemPrompt(kind) }, { role: "user", content: prompt }],
    }),
  });
  const choices = data.choices as Array<{ message?: { content?: unknown } }> | undefined;
  const content = choices?.[0]?.message?.content;
  const text = typeof content === "string" ? cleanAssistOutput(content) : "";
  if (!text) throw new Error("对话模型没有返回内容");
  return text;
}

const fatal = (error: unknown) => error instanceof Error && /API Key 无效|余额不足/.test(error.message);

/**
 * chosen:用户在设置里指定的模型,只用它,失败就报错(不悄悄换别的);
 * 不指定(自动):轻量模型优先,一个不可用就换下一个。
 */
export async function assistPrompt(
  apiKey: string, prompt: string, kind: AssistKind, relay: Relay = DEFAULT_RELAY, chosen?: string,
) {
  const texts = await textModelsFor(relay, apiKey);
  if (chosen) {
    if (!texts.includes(chosen)) {
      throw new Error(`设置里选的优化模型 ${chosen} 已下线或这个 Key 用不了，请到「设置」换一个或改回「自动」`);
    }
    try {
      return { prompt: await completeOnce(apiKey, relay, chosen, prompt, kind), model: chosen };
    } catch (error) {
      if (fatal(error)) throw error;
      throw new Error(`设置里选的优化模型 ${chosen} 暂时不可用：${(error as Error).message}。可以到「设置」换一个，或改回「自动」`);
    }
  }
  const candidates = assistCandidates(texts);
  if (!candidates.length) {
    throw new Error("这个 Key 没有可用的对话模型，无法优化提示词。可以在「设置」里给提示词优化单独填一个能用对话模型的 Key");
  }
  const remembered = workingAssistModel.get(relay.base);
  const order = remembered && candidates.includes(remembered)
    ? [remembered, ...candidates.filter((id) => id !== remembered)] : candidates;
  let lastError: unknown;
  for (const model of order.slice(0, MAX_ASSIST_ATTEMPTS)) {
    try {
      const text = await completeOnce(apiKey, relay, model, prompt, kind);
      workingAssistModel.set(relay.base, model);
      return { prompt: text, model };
    } catch (error) {
      lastError = error;
      // Key 无效、余额不足换模型也没用
      if (fatal(error)) throw error;
    }
  }
  throw new Error(`提示词优化暂时不可用：${lastError instanceof Error ? lastError.message : "中转站没有可用的对话模型"}`);
}
