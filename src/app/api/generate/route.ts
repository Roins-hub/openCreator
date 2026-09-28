import { getConversation, saveConversation } from "@/lib/conversation-store";
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
    conversation.providerId = TANGZHI_PROVIDER_ID;
    conversation.modelId = model.id;
    conversation.videoOptions = options;
    conversation.messages.push(assistant);
    conversation.updatedAt = new Date().toISOString();
    await saveConversation(userId, conversation);
    return ok({ conversation, assistant });
  } catch (error) { return failure(error); }
}
