export type TaskProtocol = "legacy" | "jimeng" | "kling";
export type TaskKind = "image" | "video";

export interface ProviderTaskRef {
  protocol: TaskProtocol;
  kind: TaskKind;
  modelId: string;
  upstreamId: string;
}

export interface ProviderTaskResult {
  status: "processing" | "succeeded" | "failed";
  urls: string[];
  error?: string;
}

const PREFIX = "mote.";

export function encodeTaskRef(task: Exclude<ProviderTaskRef, { protocol: "legacy" }>) {
  return PREFIX + Buffer.from(JSON.stringify(task), "utf8").toString("base64url");
}

export function decodeTaskRef(value: string): ProviderTaskRef {
  if (!value.startsWith(PREFIX)) {
    return { protocol: "legacy", kind: "video", modelId: "", upstreamId: value };
  }
  try {
    const parsed = JSON.parse(Buffer.from(value.slice(PREFIX.length), "base64url").toString("utf8"));
    if (
      !["jimeng", "kling"].includes(parsed.protocol) ||
      !["image", "video"].includes(parsed.kind) ||
      typeof parsed.modelId !== "string" ||
      typeof parsed.upstreamId !== "string"
    ) throw new Error("invalid task");
    return parsed as ProviderTaskRef;
  } catch {
    throw new Error("生成任务标识已损坏");
  }
}

export async function queryProviderTask(
  provider: ProviderConfig,
  value: string,
): Promise<ProviderTaskResult> {
  const task = decodeTaskRef(value);
  if (task.protocol === "jimeng") {
    return queryJimengTask(provider, task.modelId, task.upstreamId, task.kind);
  }
  if (task.protocol === "kling") {
    return queryKlingTask(provider, task.modelId, task.upstreamId, task.kind);
  }
  const data = await upstream(apiUrl(
    provider.baseUrl,
    provider.apiType === "dola"
      ? `videos/${task.upstreamId}`
      : `contents/generations/tasks/${task.upstreamId}`,
    provider.apiType,
  ), provider);
  const status = String(data.status || "").toLowerCase();
  if (["succeeded", "success", "completed"].includes(status)) {
    const url = data.content?.video_url || data.output?.video_url || data.result?.video_url || data.video_url;
    return url
      ? { status: "succeeded", urls: [url] }
      : { status: "failed", urls: [], error: "任务完成但没有返回视频地址" };
  }
  if (["failed", "cancelled", "canceled"].includes(status)) {
    return { status: "failed", urls: [], error: data.error?.message || data.error || "视频生成失败" };
  }
  return { status: "processing", urls: [] };
}

export async function cancelProviderTask(provider: ProviderConfig, value: string) {
  const task = decodeTaskRef(value);
  if (task.protocol !== "legacy") {
    return {
      cancelled: false,
      error: "该供应商暂不支持取消已提交任务；已停止本机等待，远端任务可能仍会继续",
    };
  }
  await upstream(apiUrl(
    provider.baseUrl,
    `contents/generations/tasks/${task.upstreamId}`,
    provider.apiType,
  ), provider, { method: "DELETE" });
  return { cancelled: true, error: "" };
}
import type { ProviderConfig } from "../types";
import { apiUrl, upstream } from "./common";
import { queryJimengTask } from "./jimeng";
import { queryKlingTask } from "./kling";
