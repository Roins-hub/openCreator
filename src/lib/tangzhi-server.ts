import { toVideoModels, type VideoModel } from "./tangzhi";
import { toImageModels, type ImageModel } from "./image-models";
import { assistCandidates, assistSystemPrompt, cleanAssistOutput, toTextModels, type AssistKind } from "./prompt-assist";
import { DEFAULT_RELAY, publicFetch, relayFetch, relayHost, type Relay } from "./relay";

export type CatalogModel = VideoModel | ImageModel;

const CATALOG_TTL = 60_000;
const MAX_CATALOGS = 50;
// 每个中转站地址各自缓存
const catalogs = new Map<string, { at: number; videos: VideoModel[]; images: ImageModel[]; texts: string[] }>();

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
      texts: toTextModels(payload),
    };
    if (!entry.videos.length && !entry.images.length) throw new Error("中转站暂无可用的视频或生图模型");
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

/** 视频模型在前,生图模型在后 */
export async function catalogModels(relay: Relay = DEFAULT_RELAY): Promise<CatalogModel[]> {
  const { videos, images } = await catalog(relay);
  return [...videos, ...images];
}

export async function findModel(id: string, relay: Relay = DEFAULT_RELAY) {
  const model = (await catalogModels(relay)).find((item) => item.id === id);
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

export async function generateImage(apiKey: string, body: Record<string, unknown>, relay: Relay = DEFAULT_RELAY) {
  const response = await relayFetch(relay, "/v1/images/generations", {
    method: "POST", body: JSON.stringify(body), signal: AbortSignal.timeout(300_000),
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
  });
  return imageResponse(response, relay);
}

export async function editImage(apiKey: string, form: FormData, relay: Relay = DEFAULT_RELAY) {
  const response = await relayFetch(relay, "/v1/images/edits", {
    method: "POST", body: form, signal: AbortSignal.timeout(300_000),
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  return imageResponse(response, relay);
}

// ---- 提示词优化:用中转站的对话模型扩写提示词

// 每个中转站最近一次优化成功用的模型:中转站个别模型临时不可用时,下次直接用能用的
const workingAssistModel = new Map<string, string>();
const MAX_ASSIST_ATTEMPTS = 6;

export async function assistPrompt(apiKey: string, prompt: string, kind: AssistKind, relay: Relay = DEFAULT_RELAY) {
  const candidates = assistCandidates((await catalog(relay)).texts);
  if (!candidates.length) throw new Error("中转站暂无可用的对话模型，无法优化提示词");
  const remembered = workingAssistModel.get(relay.base);
  const order = remembered && candidates.includes(remembered)
    ? [remembered, ...candidates.filter((id) => id !== remembered)] : candidates;
  let lastError: unknown;
  for (const model of order.slice(0, MAX_ASSIST_ATTEMPTS)) {
    try {
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
      workingAssistModel.set(relay.base, model);
      return { prompt: text, model };
    } catch (error) {
      lastError = error;
      // Key 无效、余额不足换模型也没用
      if (error instanceof Error && /API Key 无效|余额不足/.test(error.message)) throw error;
    }
  }
  throw new Error(`提示词优化暂时不可用：${lastError instanceof Error ? lastError.message : "中转站没有可用的对话模型"}`);
}
