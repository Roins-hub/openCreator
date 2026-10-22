import { getConversation, updateConversation } from "@/lib/conversation-store";
import { failure, ok } from "@/lib/http";
import { recordAsset } from "@/lib/asset-store";
import { keyByHint, requireUser, videoKeysOf } from "@/lib/identity";
import { mediaKey } from "@/lib/media-store";
import { deleteObject, putObject } from "@/lib/object-store";
import { decodeTaskId, downloadVideo, queryVideoTask, type TaskResult } from "@/lib/tangzhi-server";
import { checkImageTask, isImageTask } from "@/lib/image-jobs";
import { hasTask, isTerminal, settleTask } from "@/lib/task-settle";
import type { MediaRef } from "@/lib/types";
import type { Relay } from "@/lib/relay";

/** 同一任务被多个标签页/请求同时查到完成时,只下载一次 */
const downloads = new Map<string, Promise<{ video: MediaRef; size: number }>>();
function fetchVideo(apiKey: string, userId: string, upstreamId: string, relay: Relay) {
  const key = `${userId}/${upstreamId}`;
  let pending = downloads.get(key);
  if (!pending) {
    pending = (async () => {
      // 从中转站取回视频,直接写入对象存储(不落服务器磁盘)
      const bytes = await downloadVideo(apiKey, upstreamId, relay);
      const name = `tz-${new Date().toISOString().slice(0, 10)}-${upstreamId.slice(-8)}.mp4`;
      const video: MediaRef = {
        kind: "video", path: mediaKey(userId, "videos", name), name, mimeType: "video/mp4", size: bytes.byteLength,
      };
      await putObject(video.path, bytes, "video/mp4");
      return { video, size: bytes.byteLength };
    })().finally(() => downloads.delete(key));
    downloads.set(key, pending);
  }
  return pending;
}

/**
 * 查询一个视频任务并把结果写回对话。查询中转站、下载视频在锁外进行,
 * 写回时在锁内重新读取对话,同一对话里多个任务并发轮询也不会互相覆盖。
 * 「已停止」的旧任务(早期版本的停止按钮)查询后会恢复为生成中或直接取回结果。
 */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { apiKey, userId, relay } = await requireUser(request);
    const taskId = (await context.params).id;
    const conversationId = new URL(request.url).searchParams.get("conversationId") || "";
    const snapshot = await getConversation(userId, conversationId);
    if (!snapshot) throw new Error("会话不存在");
    const current = snapshot.messages.find((item) => hasTask(item, taskId));
    if (!current) throw new Error("生成消息不存在");
    if (isTerminal(current, taskId)) return ok({ status: "unchanged", conversation: snapshot, message: current });
    // 生图在服务端后台进行,这里只看任务是否还在跑
    if (isImageTask(taskId)) {
      const conversation = await checkImageTask(userId, conversationId, taskId);
      return ok({ status: "processing", conversation, message: conversation.messages.find((item) => hasTask(item, taskId)) });
    }

    const upstreamId = decodeTaskId(taskId);
    // 有多个视频 Key 时,用提交这个任务的那个(按记下的指纹找);找不到就用主要的
    const taskKey = keyByHint(videoKeysOf(request, apiKey), current.generation?.keyHint) || apiKey;
    // 切换到 Tangzhi 之前由其他供应商提交的任务,已无法查询
    const task: TaskResult = upstreamId ? await queryVideoTask(taskKey, upstreamId, relay)
      : { status: "failed", error: "该任务来自已移除的供应商，无法继续查询" };
    const fetched = task.status === "succeeded" && upstreamId ? await fetchVideo(taskKey, userId, upstreamId, relay) : undefined;

    let applied = false;
    const conversation = await updateConversation(userId, conversationId, (latest) => {
      const message = latest.messages.find((item) => hasTask(item, taskId));
      if (!message || isTerminal(message, taskId)) return;
      applied = true;
      if (task.status === "succeeded") {
        settleTask(message, taskId, { status: "succeeded", media: fetched?.video, elapsedMs: task.elapsedMs });
        latest.updatedAt = new Date().toISOString();
      } else if (task.status === "failed") {
        settleTask(message, taskId, { status: "failed", error: task.error, elapsedMs: task.elapsedMs });
      } else if (message.status === "stopped") {
        message.status = "processing";
        delete message.error;
      }
    });
    if (fetched) {
      if (applied) {
        await recordAsset(userId, {
          kind: "video", path: fetched.video.path, name: fetched.video.name, mimeType: "video/mp4", size: fetched.size,
          createdAt: new Date().toISOString(), conversationId,
        });
      } else if (!JSON.stringify(conversation).includes(fetched.video.path)) {
        // 记录已被删除,或另一个请求存的是另一份文件:清掉这份没人用的视频。
        // 同时查到完成的几个请求共用同一次下载、同一个文件,已经写进对话的那份不能删
        await deleteObject(fetched.video.path).catch(() => undefined);
      }
    }
    const message = conversation.messages.find((item) => hasTask(item, taskId));
    return ok({ status: task.status, progress: task.progress, conversation, message });
  } catch (error) { return failure(error); }
}
