import { getConversation, updateConversation } from "@/lib/conversation-store";
import { failure, ok } from "@/lib/http";
import { generateRequestSchema } from "@/lib/schemas";
import {
  buildVideoRequest, TANGZHI_PROVIDER_ID, TANGZHI_PROVIDER_NAME, videoRequestError,
} from "@/lib/tangzhi";
import { imageKeysOf, isImageOnly, keyHint, mediaPrefixes, requireUser, videoKeysOf } from "@/lib/identity";
import { externalMediaUrl } from "@/lib/object-store";
import { encodeTaskId, findModel, pickKey, publicOrigin, submitVideoTask } from "@/lib/tangzhi-server";
import { fitImageOptions, fitImageToModel, imageRequestError, type ImageModel } from "@/lib/image-models";
import { newImageTaskId, startImageJob } from "@/lib/image-jobs";
import type { Relay } from "@/lib/relay";
import type { Conversation, MediaRef, Message } from "@/lib/types";

/** 先记下用户消息:提交失败时提示词也不会丢 */
async function recordUserMessage(userId: string, conversationId: string, id: string | undefined, prompt: string, attachments: MediaRef[], fallbackTitle: string) {
  if (!id) return;
  const userMessage: Message = {
    id, role: "user", content: prompt, attachments, createdAt: new Date().toISOString(), status: "complete",
  };
  await updateConversation(userId, conversationId, (current) => {
    if (current.messages.some((item) => item.id === userMessage.id)) return;
    if (!current.messages.length) current.title = (prompt || fallbackTitle).slice(0, 28);
    current.messages.push(userMessage);
    current.updatedAt = userMessage.createdAt;
  });
}

/** 生图:写一条「生成中」记录后立刻返回,每张图各自在后台生成(见 image-jobs) */
async function generateImages(
  { apiKey, userId, relay }: { apiKey: string; userId: string; relay: Relay },
  conversation: Conversation, model: ImageModel,
  input: { prompt: string; attachments: MediaRef[]; userMessageId?: string; imageOptions?: unknown },
) {
  const options = fitImageToModel(model, fitImageOptions(input.imageOptions as never));
  const invalid = imageRequestError(model, input.prompt, options, input.attachments);
  if (invalid) throw new Error(invalid);
  await recordUserMessage(userId, conversation.id, input.userMessageId, input.prompt, input.attachments, "图片生成");
  const taskIds = Array.from({ length: options.count }, newImageTaskId);
  const assistant: Message = {
    id: crypto.randomUUID(), role: "assistant", content: "", createdAt: new Date().toISOString(),
    status: "processing", taskId: taskIds[0], taskIds, completedTaskIds: [], failedTaskIds: [],
    ...(input.userMessageId ? { replyTo: input.userMessageId } : {}),
    generation: {
      type: "image", providerName: TANGZHI_PROVIDER_NAME, modelName: model.id, modelId: model.id, imageOptions: options,
    },
  };
  const saved = await updateConversation(userId, conversation.id, (current) => {
    current.providerId = TANGZHI_PROVIDER_ID;
    current.modelId = model.id;
    current.imageOptions = options;
    current.messages.push(assistant);
    current.updatedAt = new Date().toISOString();
  });
  for (const taskId of taskIds) {
    startImageJob({
      userId, apiKey, relay, conversationId: conversation.id, taskId, model,
      prompt: input.prompt, options, references: input.attachments,
    });
  }
  return ok({ conversation: saved, assistant });
}

export async function POST(request: Request) {
  try {
    const { apiKey, userId, relay } = await requireUser(request);
    const input = generateRequestSchema.parse(await request.json());
    const conversation = await getConversation(userId, input.conversationId);
    if (!conversation) throw new Error("会话不存在");
    // 视频走视频的 Key,图片走图片的 Key(没单独填就是同一个),各自可以有多个;对话和资产都记在账号 Key 下
    const videoKeys = videoKeysOf(request, apiKey);
    const imageKeys = imageKeysOf(request, apiKey);
    const model = await findModel(input.modelId, relay, videoKeys, imageKeys);
    // 只能引用自己的素材
    const prefixes = await mediaPrefixes(userId);
    if (input.attachments.some((item) => !prefixes.some((prefix) => item.path.startsWith(prefix)))) {
      throw new Error("参考素材不存在，请重新上传");
    }
    if (model.type === "image") {
      const imageKey = (await pickKey(relay, imageKeys, model.id)) || apiKey;
      return await generateImages({ apiKey: imageKey, userId, relay }, conversation, model, input);
    }
    if (isImageOnly(request)) throw new Error("还没有填写视频的 Key，不能生成视频。请到「设置」填写视频的 Key");

    const options = input.videoOptions;
    if (!options) throw new Error("缺少视频参数");
    // 几个视频 Key 里用能调用这个模型的那个;记下它的指纹,查询和下载视频时找回同一个 Key
    const videoKey = (await pickKey(relay, videoKeys, model.id)) || apiKey;
    const invalid = videoRequestError(model, input.prompt, options, input.attachments);
    if (invalid) throw new Error(invalid);
    // 给中转站的是 24 小时有效的临时链接
    const origin = publicOrigin(request);
    const urls = new Map(await Promise.all(input.attachments.map(async (item) =>
      [item.path, await externalMediaUrl(item.path, origin)] as const)));
    await recordUserMessage(userId, conversation.id, input.userMessageId, input.prompt, input.attachments, "视频生成");
    const batch = `mote_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;
    const taskIds: string[] = [];
    let submitError: unknown;
    try {
      for (let index = 0; index < options.count; index++) {
        const body = buildVideoRequest(
          model, input.prompt, options, input.attachments,
          (media) => urls.get(media.path) || "", `${batch}_${index + 1}`,
        );
        taskIds.push(encodeTaskId(await submitVideoTask(videoKey, body, request.signal, relay)));
      }
    } catch (error) {
      // 一个都没提交成功、也没有记下提示词时,直接把错误返回给浏览器
      if (!taskIds.length && !input.userMessageId) throw error;
      submitError = error;
    }

    const failedMessage = submitError instanceof Error ? submitError.message : submitError ? "提交生成任务失败" : undefined;
    const assistant: Message = {
      id: crypto.randomUUID(), role: "assistant", content: "",
      createdAt: new Date().toISOString(),
      // 提交失败也留一张失败卡片(和提示词配对),可以看到原因、重新生成或删除
      status: taskIds.length ? "processing" : "failed",
      ...(failedMessage ? { error: failedMessage } : {}),
      ...(input.userMessageId ? { replyTo: input.userMessageId } : {}),
      ...(taskIds.length ? { taskId: taskIds[0], taskIds, completedTaskIds: [], failedTaskIds: [] } : {}),
      generation: {
        type: "video", providerName: TANGZHI_PROVIDER_NAME, modelName: model.id, modelId: model.id,
        videoOptions: options,
        ...(videoKeys.length > 1 ? { keyHint: keyHint(videoKey) } : {}),
      },
    };
    // 同一对话可以同时有多个生成任务:在锁内追加,不覆盖其他请求写入的消息
    const saved = await updateConversation(userId, conversation.id, (current) => {
      current.providerId = TANGZHI_PROVIDER_ID;
      current.modelId = model.id;
      current.videoOptions = options;
      current.messages.push(assistant);
      current.updatedAt = new Date().toISOString();
    });
    if (!taskIds.length) throw submitError;
    return ok({ conversation: saved, assistant });
  } catch (error) { return failure(error); }
}
