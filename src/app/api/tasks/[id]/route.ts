import { getConversation, saveConversation } from "@/lib/conversation-store";
import { failure, ok } from "@/lib/http";
import { stopMessageText, unfinishedTaskIds } from "@/lib/generation-stop";
import { recordAsset } from "@/lib/asset-store";
import { requireUser } from "@/lib/identity";
import { mediaKey } from "@/lib/media-store";
import { putObject } from "@/lib/object-store";
import { decodeTaskId, downloadVideo, queryVideoTask, type TaskResult } from "@/lib/tangzhi-server";
import type { MediaRef } from "@/lib/types";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { apiKey, userId } = await requireUser(request);
    const taskId = (await context.params).id;
    const query = new URL(request.url).searchParams;
    const conversation = await getConversation(userId, query.get("conversationId") || "");
    if (!conversation) throw new Error("会话不存在");
    const message = conversation.messages.find((item) =>
      item.taskId === taskId || item.taskIds?.includes(taskId));
    if (!message) throw new Error("生成消息不存在");

    const upstreamId = decodeTaskId(taskId);
    let task: TaskResult;
    if (!upstreamId) {
      // 切换到 Tangzhi 之前由其他供应商提交的任务,已无法查询
      task = { status: "failed", error: "该任务来自已移除的供应商，无法继续查询" };
    } else {
      task = await queryVideoTask(apiKey, upstreamId);
      if (task.status === "succeeded" && !message.completedTaskIds?.includes(taskId)) {
        // 从中转站取回视频,直接写入对象存储(不落服务器磁盘)
        const bytes = await downloadVideo(apiKey, upstreamId);
        const name = `mote-${new Date().toISOString().slice(0, 10)}-${upstreamId.slice(-8)}.mp4`;
        const video: MediaRef = { kind: "video", path: mediaKey(userId, "videos", name), name, mimeType: "video/mp4" };
        await putObject(video.path, bytes, "video/mp4");
        await recordAsset(userId, {
          kind: "video", path: video.path, name, mimeType: "video/mp4", size: bytes.byteLength,
          createdAt: new Date().toISOString(), conversationId: conversation.id,
        });
        message.media = [...(message.media || []), video];
      }
    }

    if (task.status === "succeeded") {
      message.completedTaskIds = [...new Set([...(message.completedTaskIds || []), taskId])];
      conversation.updatedAt = new Date().toISOString();
    } else if (task.status === "failed") {
      message.failedTaskIds = [...new Set([...(message.failedTaskIds || []), taskId])];
      message.error = task.error || "部分生成任务失败";
    }
    const terminalCount = (message.completedTaskIds?.length || 0) + (message.failedTaskIds?.length || 0);
    const totalCount = message.taskIds?.length || 1;
    if (terminalCount >= totalCount) {
      message.status = message.completedTaskIds?.length ? "complete" : "failed";
    }
    await saveConversation(userId, conversation);
    return ok({ status: task.status, progress: task.progress, conversation });
  } catch (error) { return failure(error); }
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { userId } = await requireUser(request);
    const taskId = (await context.params).id;
    const query = new URL(request.url).searchParams;
    const conversation = await getConversation(userId, query.get("conversationId") || "");
    if (!conversation) throw new Error("会话不存在");
    const message = conversation.messages.find((item) =>
      ["processing", "stopped"].includes(item.status) && unfinishedTaskIds(item).includes(taskId));
    if (!message) throw new Error("待停止的视频任务不存在");
    // 中转站没有取消接口:只停止本机等待,云端任务会继续并按规则计费
    message.status = "stopped";
    message.error = stopMessageText(message.error, "中转站不支持取消任务；已停止本机等待，云端任务可能仍会继续");
    conversation.updatedAt = new Date().toISOString();
    await saveConversation(userId, conversation);
    return ok({ conversation, cancelled: false });
  } catch (error) { return failure(error); }
}
