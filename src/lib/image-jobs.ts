import { recordAsset } from "./asset-store";
import { getConversation, updateConversation } from "./conversation-store";
import { imageSize, nearestChatRatio, withComposition, type ImageModel } from "./image-models";
import { mediaKey } from "./media-store";
import { deleteObject, getObject, putObject } from "./object-store";
import type { Relay } from "./relay";
import { hasTask, isTerminal, settleTask } from "./task-settle";
import { chatImage, editImage, generateImage, type ImageResult } from "./tangzhi-server";
import type { ImageOptions, MediaRef } from "./types";

/**
 * 生图任务在服务端后台跑:中转站同步出图要 1~5 分钟,不能让浏览器的请求一直挂着(网关会超时)。
 * 提交时先写一条「生成中」的记录并立刻返回,出图后存进对象存储、写回对话;
 * 浏览器照常轮询 /api/tasks/<id>,和视频任务走同一套展示。
 * 任务 ID 形如 img.<随机串>;进程重启后丢失的任务在下次查询时判为失败。
 */
export const IMAGE_TASK_PREFIX = "img.";
export const isImageTask = (taskId: string) => taskId.startsWith(IMAGE_TASK_PREFIX);
export const newImageTaskId = () => `${IMAGE_TASK_PREFIX}${crypto.randomUUID().replace(/-/g, "")}`;

const running = new Set<string>();

export interface ImageJob {
  userId: string;
  apiKey: string;
  relay: Relay;
  conversationId: string;
  taskId: string;
  model: ImageModel;
  prompt: string;
  options: ImageOptions;
  references: MediaRef[];
}

const EXTENSION: Record<ImageOptions["format"], string> = { png: "png", jpeg: "jpg", webp: "webp" };

/** 生成请求参数(文生图 JSON / 图生图表单共用) */
export function imageRequestFields(model: ImageModel, prompt: string, options: ImageOptions) {
  const { width, height } = imageSize(options.ratio, options.resolution, model.sizes);
  return {
    model: model.id,
    prompt: withComposition(prompt.trim(), options.ratio),
    size: `${width}x${height}`,
    background: options.background,
    output_format: options.format,
    n: 1,
    // 按 quality 分档的模型(Gemini 生图等):档位要单独传,只给尺寸会按 1K 出图计费
    ...(model.qualityParam ? { quality: options.resolution } : {}),
  };
}

async function requestImage(job: ImageJob): Promise<ImageResult> {
  if (job.model.api === "chat") {
    const references = await Promise.all(job.references.map(async (reference) => ({
      bytes: await getObject(reference.path), mimeType: reference.mimeType || "image/png",
    })));
    return chatImage(job.apiKey, {
      model: job.model.id,
      prompt: job.prompt.trim(),
      aspectRatio: nearestChatRatio(job.options.ratio),
      imageSize: job.options.resolution.toUpperCase(),
      references,
    }, job.relay, job.taskId);
  }
  const fields = imageRequestFields(job.model, job.prompt, job.options);
  if (!job.references.length) return generateImage(job.apiKey, fields, job.relay, job.taskId);
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) form.set(key, String(value));
  const field = job.references.length === 1 ? "image" : "image[]";
  for (const reference of job.references) {
    const bytes = await getObject(reference.path);
    form.append(field, new Blob([bytes as BlobPart], { type: reference.mimeType || "image/png" }), reference.name || "reference.png");
  }
  return editImage(job.apiKey, form, job.relay, job.taskId);
}

async function runImageJob(job: ImageJob) {
  const started = Date.now();
  let media: MediaRef | undefined;
  let size = 0;
  let error: string | undefined;
  try {
    const result = await requestImage(job);
    const format = /webp/.test(result.mimeType) ? "webp" : /jpe?g/.test(result.mimeType) ? "jpeg" : result.mimeType ? "png" : job.options.format;
    const name = `tz-${new Date().toISOString().slice(0, 10)}-${job.taskId.slice(-8)}.${EXTENSION[format]}`;
    const mimeType = `image/${format}`;
    media = { kind: "image", path: mediaKey(job.userId, "images", name), name, mimeType, size: result.bytes.byteLength };
    await putObject(media.path, result.bytes, mimeType);
    size = result.bytes.byteLength;
  } catch (cause) {
    media = undefined;
    error = cause instanceof Error ? cause.message : "图片生成失败";
  }
  const elapsedMs = Date.now() - started;
  let applied = false;
  await updateConversation(job.userId, job.conversationId, (latest) => {
    const message = latest.messages.find((item) => hasTask(item, job.taskId));
    if (!message || isTerminal(message, job.taskId)) return;
    applied = true;
    settleTask(message, job.taskId, media ? { status: "succeeded", media, elapsedMs } : { status: "failed", error, elapsedMs });
    if (media) latest.updatedAt = new Date().toISOString();
  }).catch(() => undefined);
  if (!media) return;
  if (applied) {
    await recordAsset(job.userId, {
      kind: "image", path: media.path, name: media.name, mimeType: media.mimeType || "image/png", size,
      createdAt: new Date().toISOString(), conversationId: job.conversationId,
    }).catch(() => undefined);
  } else {
    // 记录已被删除:清掉这张图
    await deleteObject(media.path).catch(() => undefined);
  }
}

export function startImageJob(job: ImageJob) {
  running.add(job.taskId);
  void runImageJob(job).finally(() => running.delete(job.taskId));
}

/** 进程重启后,内存里没有的「生成中」任务不会再有结果:超过宽限时间就判为失败 */
const RESTART_GRACE_MS = 60_000;

export async function checkImageTask(userId: string, conversationId: string, taskId: string) {
  const snapshot = await getConversation(userId, conversationId);
  if (!snapshot) throw new Error("会话不存在");
  const message = snapshot.messages.find((item) => hasTask(item, taskId));
  if (!message || isTerminal(message, taskId) || running.has(taskId)) return snapshot;
  if (Date.now() - new Date(message.createdAt).getTime() < RESTART_GRACE_MS) return snapshot;
  return updateConversation(userId, conversationId, (latest) => {
    const current = latest.messages.find((item) => hasTask(item, taskId));
    if (!current || isTerminal(current, taskId) || running.has(taskId)) return;
    settleTask(current, taskId, { status: "failed", error: "服务重启，这张图片的生成中断了，请重新生成" });
  });
}
