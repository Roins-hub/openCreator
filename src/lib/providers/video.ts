import type { MediaRef, ModelConfig, ProviderConfig, VideoOptions } from "../types";
import { attachmentDataUrl } from "../media-store";
import { apiUrl, upstream } from "./common";
import { buildJimengVideoRequest, submitJimengTask } from "./jimeng";
import { buildKlingVideoRequest, submitKlingVideoTask } from "./kling";
import { encodeTaskRef } from "./tasks";

export function videoPrompt(prompt: string, options: VideoOptions) {
  return `${prompt} --ratio ${options.ratio} --resolution ${options.resolution} --duration ${options.duration}` +
    ` --audio ${options.audio} --watermark ${options.watermark} --camerafixed ${options.cameraFixed}`;
}

export function buildVideoContent(prompt: string, images: string[], options: VideoOptions) {
  if (options.referenceMode === "first_last" && images.length !== 2) {
    throw new Error("首尾帧模式需要两张参考图");
  }
  if (options.referenceMode === "first" && images.length < 1) {
    throw new Error("首帧模式需要一张参考图");
  }
  const usedImages = options.referenceMode === "text" ? [] :
    options.referenceMode === "first_last" ? images.slice(0, 2) :
      options.referenceMode === "references" ? images : images.slice(0, 1);
  return [
    { type: "text", text: videoPrompt(prompt, options) },
    ...usedImages.map((url, index) => ({
      type: "image_url",
      image_url: { url },
      role: options.referenceMode === "references" ? "reference_image" :
        index === 0 ? "first_frame" : "last_frame",
    })),
  ];
}

function dolaSize(options: VideoOptions) {
  const ratio = options.ratio === "adaptive" ? "16:9" : options.ratio;
  const resolution = options.resolution === "4k" ? "1080p" : options.resolution;
  const short = resolution === "1080p" ? 1080 : 720;
  const sizes: Record<string, string> = {
    "16:9": `${short === 1080 ? 1920 : 1280}x${short === 1080 ? 1080 : 720}`,
    "9:16": `${short === 1080 ? 1080 : 720}x${short === 1080 ? 1920 : 1280}`,
    "1:1": `${short}x${short}`,
    "4:3": `${short === 1080 ? 1440 : 960}x${short}`,
    "3:4": `${short}x${short === 1080 ? 1440 : 960}`,
    "21:9": `${short === 1080 ? 2520 : 1680}x${short}`,
  };
  return sizes[ratio] || sizes["16:9"];
}

export async function createVideoTask(
  provider: ProviderConfig, model: ModelConfig, prompt: string,
  attachments: MediaRef[], options: VideoOptions, signal?: AbortSignal,
) {
  const images = await Promise.all(attachments.map(attachmentDataUrl));
  if (provider.apiType === "jimeng") {
    const upstreamId = await submitJimengTask(
      provider,
      buildJimengVideoRequest(model.modelId, prompt, images, options),
      signal,
    );
    return encodeTaskRef({
      protocol: "jimeng", kind: "video", modelId: model.modelId, upstreamId,
    });
  }
  if (provider.apiType === "kling") {
    const upstreamId = await submitKlingVideoTask(
      provider,
      model.modelId,
      options.referenceMode,
      buildKlingVideoRequest(prompt, images, options),
      signal,
    );
    return encodeTaskRef({
      protocol: "kling", kind: "video", modelId: model.modelId, upstreamId,
    });
  }
  if (provider.apiType === "dola") {
    if (options.referenceMode === "first_last" && images.length !== 2) {
      throw new Error("首尾帧模式需要两张参考图");
    }
    const references = options.referenceMode === "text" ? [] :
      options.referenceMode === "first_last" ? images.slice(0, 2) :
        options.referenceMode === "references" ? images : images.slice(0, 1);
    const payload: Record<string, unknown> = {
      model: model.modelId,
      prompt,
      duration: options.duration,
      size: dolaSize(options),
    };
    if (references.length) payload.reference_images = references;
    const data = await upstream(apiUrl(provider.baseUrl, "videos/generations", "dola"), provider, {
      method: "POST", signal, body: JSON.stringify(payload),
    });
    const taskId = data.id || data.task_id;
    if (typeof taskId !== "string" || !taskId) throw new Error("Dola 未返回任务 ID");
    return taskId;
  }
  const content = buildVideoContent(prompt, images, options);
  const data = await upstream(apiUrl(provider.baseUrl, "contents/generations/tasks", provider.apiType), provider, {
    method: "POST", signal, body: JSON.stringify({ model: model.modelId, content }),
  });
  return data.id as string;
}

export async function getVideoTask(provider: ProviderConfig, taskId: string) {
  if (provider.apiType === "dola") {
    return upstream(apiUrl(provider.baseUrl, `videos/${taskId}`, "dola"), provider);
  }
  return upstream(apiUrl(
    provider.baseUrl, `contents/generations/tasks/${taskId}`, provider.apiType,
  ), provider);
}

export async function cancelVideoTask(provider: ProviderConfig, taskId: string) {
  if (provider.apiType === "dola") {
    return { cancelled: false, error: "Dola Pool 当前接口不提供取消任务；已停止本机等待，远端任务可能继续生成" };
  }
  return upstream(apiUrl(
    provider.baseUrl, `contents/generations/tasks/${taskId}`, provider.apiType,
  ), provider, { method: "DELETE" });
}
