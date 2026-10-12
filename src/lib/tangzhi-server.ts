import { FIXED_VIDEO_MODELS, toVideoModels, type VideoModel } from "./tangzhi";
import { DEFAULT_RELAY, relayFetch, relayHost, type Relay } from "./relay";

const CATALOG_TTL = 60_000;
const MAX_CATALOGS = 50;
// 每个中转站地址各自缓存
const catalogs = new Map<string, { at: number; models: VideoModel[] }>();

/**
 * 内置中转站(1xxAI)使用当前开放的固定视频目录;
 * 自定义中转站读取公开定价接口(new-api 的 /api/pricing)里的视频模型(1 分钟缓存,失败时沿用上次结果)。
 */
export async function videoModels(relay: Relay = DEFAULT_RELAY): Promise<VideoModel[]> {
  if (!relay.custom) return FIXED_VIDEO_MODELS;
  const catalog = catalogs.get(relay.base);
  if (catalog && Date.now() - catalog.at < CATALOG_TTL) return catalog.models;
  try {
    const response = await relayFetch(relay, "/api/pricing", { signal: AbortSignal.timeout(15_000) });
    if (!response.ok) throw new Error(`模型列表返回 ${response.status}`);
    const models = toVideoModels(await response.json().catch(() => {
      throw new Error("模型列表格式不正确（需要 new-api 兼容的中转站）");
    }));
    if (!models.length) throw new Error("中转站暂无可用视频模型");
    if (catalogs.size >= MAX_CATALOGS && !catalogs.has(relay.base)) catalogs.delete(catalogs.keys().next().value as string);
    catalogs.set(relay.base, { at: Date.now(), models });
    return models;
  } catch (error) {
    if (catalog) return catalog.models;
    throw new Error(`无法获取中转站模型：${(error as Error).message}`);
  }
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
  return `中转站余额不足：${detail}请到 ${host} 充值，或改用更短时长、更便宜的模型。`;
}

async function call(relay: Relay, apiKey: string, path: string, init: RequestInit = {}) {
  const response = await relayFetch(relay, path, {
    ...init,
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json", ...init.headers },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401) throw new Error("令牌无效或已过期：已登录账号请退出后重新登录，使用自定义中转站请在设置中检查 API Key");
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
}

export async function queryVideoTask(apiKey: string, taskId: string, relay: Relay = DEFAULT_RELAY): Promise<TaskResult> {
  const data = await call(relay, apiKey, `/v1/videos/${encodeURIComponent(taskId)}`);
  const status = String(data.status || "").toLowerCase();
  if (["completed", "succeeded", "success"].includes(status)) return { status: "succeeded" };
  if (["failed", "cancelled", "canceled", "expired"].includes(status)) {
    return { status: "failed", error: upstreamMessage(data, 200).replace(/^中转站返回 200$/, "视频生成失败") };
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
