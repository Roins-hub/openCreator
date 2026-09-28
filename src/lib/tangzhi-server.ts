import { TANGZHI_BASE_URL, toVideoModels, type VideoModel } from "./tangzhi";

const CATALOG_TTL = 60_000;
let catalog: { at: number; models: VideoModel[] } | undefined;

/** 读取中转站公开定价接口里的视频模型(1 分钟缓存,失败时沿用上次结果)。 */
export async function videoModels(): Promise<VideoModel[]> {
  if (catalog && Date.now() - catalog.at < CATALOG_TTL) return catalog.models;
  try {
    const response = await fetch(`${TANGZHI_BASE_URL}/api/pricing`, {
      cache: "no-store", signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error(`模型列表返回 ${response.status}`);
    const models = toVideoModels(await response.json());
    if (!models.length) throw new Error("中转站暂无可用视频模型");
    catalog = { at: Date.now(), models };
    return models;
  } catch (error) {
    if (catalog) return catalog.models;
    throw new Error(`无法获取中转站模型：${(error as Error).message}`);
  }
}

export async function findVideoModel(id: string) {
  const model = (await videoModels()).find((item) => item.id === id);
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
export function friendlyMessage(message: string) {
  if (!/预扣费额度失败|额度不足|余额不足|insufficient/i.test(message)) return message;
  const left = message.match(/剩余额度[:：]\s*[^\d-]*([\d.]+)/)?.[1];
  const need = message.match(/需要预扣费额度[:：]\s*[^\d-]*([\d.]+)/)?.[1];
  const detail = left && need ? `本次需预扣 ${Number(need).toFixed(2)}，当前剩余 ${Number(left).toFixed(2)}。` : "";
  return `中转站余额不足：${detail}请到 new.tangzhi.org 充值，或改用更短时长、更便宜的模型。`;
}

async function call(apiKey: string, path: string, init: RequestInit = {}) {
  const response = await fetch(`${TANGZHI_BASE_URL}${path}`, {
    ...init,
    cache: "no-store",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json", ...init.headers },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401) throw new Error("API Key 无效或已过期，请在设置中检查");
    throw new Error(friendlyMessage(upstreamMessage(data, response.status)));
  }
  return data as Record<string, unknown>;
}

export async function submitVideoTask(apiKey: string, body: Record<string, unknown>, signal?: AbortSignal) {
  const data = await call(apiKey, "/v1/videos", { method: "POST", body: JSON.stringify(body), signal });
  const id = data.id || data.task_id;
  if (typeof id !== "string" || !id) throw new Error("中转站未返回任务 ID");
  return id;
}

export interface TaskResult {
  status: "processing" | "succeeded" | "failed";
  progress?: number;
  error?: string;
}

export async function queryVideoTask(apiKey: string, taskId: string): Promise<TaskResult> {
  const data = await call(apiKey, `/v1/videos/${encodeURIComponent(taskId)}`);
  const status = String(data.status || "").toLowerCase();
  if (["completed", "succeeded", "success"].includes(status)) return { status: "succeeded" };
  if (["failed", "cancelled", "canceled", "expired"].includes(status)) {
    return { status: "failed", error: upstreamMessage(data, 200).replace(/^中转站返回 200$/, "视频生成失败") };
  }
  return { status: "processing", progress: Number(data.progress) || 0 };
}

/** 完成后的视频需要带鉴权从 /content 下载。 */
export async function downloadVideo(apiKey: string, taskId: string) {
  const response = await fetch(`${TANGZHI_BASE_URL}/v1/videos/${encodeURIComponent(taskId)}/content`, {
    headers: { Authorization: `Bearer ${apiKey}` }, cache: "no-store",
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
