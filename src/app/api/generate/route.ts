import { getConversation, updateConversation } from "@/lib/conversation-store";
import { failure, ok } from "@/lib/http";
import { generateRequestSchema } from "@/lib/schemas";
import {
  buildVideoRequest, TANGZHI_PROVIDER_ID, TANGZHI_PROVIDER_NAME, videoRequestError,
} from "@/lib/tangzhi";
import { mediaPrefix, requireUser } from "@/lib/identity";
import { externalMediaUrl } from "@/lib/object-store";
import { encodeTaskId, findVideoModel, publicOrigin, submitVideoTask } from "@/lib/tangzhi-server";
import type { Message } from "@/lib/types";

export async function POST(request: Request) {
  try {
    const { apiKey, userId } = await requireUser(request);
    const input = generateRequestSchema.parse(await request.json());
    const conversation = await getConversation(userId, input.conversationId);
    if (!conversation) throw new Error("会话不存在");
    const model = await findVideoModel(input.modelId);
    const options = input.videoOptions;
    const invalid = videoRequestError(model, input.prompt, options, input.attachments);
    if (invalid) throw new Error(invalid);

    // 只能引用自己的素材;给中转站的是 24 小时有效的临时链接
    if (input.attachments.some((item) => !item.path.startsWith(mediaPrefix(userId)))) {
      throw new Error("参考素材不存在，请重新上传");
    }
    const origin = publicOrigin(request);
    const urls = new Map(await Promise.all(input.attachments.map(async (item) =>
      [item.path, await externalMediaUrl(item.path, origin)] as const)));
    // 先记下用户消息:提交失败时提示词也不会丢
    if (input.userMessageId) {
      const userMessage: Message = {
        id: input.userMessageId, role: "user", content: input.prompt, attachments: input.attachments,
        createdAt: new Date().toISOString(), status: "complete",
      };
      await updateConversation(userId, conversation.id, (current) => {
        if (current.messages.some((item) => item.id === userMessage.id)) return;
        if (!current.messages.length) current.title = (input.prompt || "视频生成").slice(0, 28);
        current.messages.push(userMessage);
        current.updatedAt = userMessage.createdAt;
      });
    }
    const batch = `mote_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;
    const taskIds: string[] = [];
    for (let index = 0; index < options.count; index++) {
      const body = buildVideoRequest(
        model, input.prompt, options, input.attachments,
        (media) => urls.get(media.path) || "", `${batch}_${index + 1}`,
      );
      taskIds.push(encodeTaskId(await submitVideoTask(apiKey, body, request.signal)));
    }

    const assistant: Message = {
      id: crypto.randomUUID(), role: "assistant", content: "",
      createdAt: new Date().toISOString(), status: "processing",
      taskId: taskIds[0], taskIds, completedTaskIds: [], failedTaskIds: [],
      generation: {
        type: "video", providerName: TANGZHI_PROVIDER_NAME, modelName: model.id, modelId: model.id,
        videoOptions: options,
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
    return ok({ conversation: saved, assistant });
  } catch (error) { return failure(error); }
}
