import type { MediaRef, Message } from "./types";

export const hasTask = (message: Message, taskId: string) =>
  message.taskId === taskId || Boolean(message.taskIds?.includes(taskId));

export const isTerminal = (message: Message, taskId: string) =>
  Boolean(message.completedTaskIds?.includes(taskId) || message.failedTaskIds?.includes(taskId));

export type TaskOutcome =
  | { status: "succeeded"; media?: MediaRef; elapsedMs?: number }
  | { status: "failed"; error?: string; elapsedMs?: number };

/**
 * 把一个任务的结果写进生成记录(在对话锁内调用)。视频轮询和后台生图共用:
 * 每个任务只结算一次;全部任务结束后决定整条记录是完成还是失败;记下最长的用时。
 */
export function settleTask(message: Message, taskId: string, outcome: TaskOutcome) {
  if (outcome.status === "succeeded") {
    if (outcome.media) message.media = [...(message.media || []), outcome.media];
    message.completedTaskIds = [...(message.completedTaskIds || []), taskId];
  } else {
    message.failedTaskIds = [...(message.failedTaskIds || []), taskId];
    message.error = outcome.error || "部分生成任务失败";
  }
  // 优先用中转站记录的用时;拿不到时按提交到现在估算
  const elapsed = outcome.elapsedMs ?? Date.now() - new Date(message.createdAt).getTime();
  if (elapsed >= 0) message.elapsedMs = Math.max(message.elapsedMs || 0, Math.round(elapsed));
  const terminalCount = (message.completedTaskIds?.length || 0) + (message.failedTaskIds?.length || 0);
  const totalCount = message.taskIds?.length || 1;
  if (terminalCount >= totalCount) {
    message.status = message.completedTaskIds?.length ? "complete" : "failed";
    if (message.status === "complete" && !message.failedTaskIds?.length) delete message.error;
  } else if (message.status === "stopped") {
    message.status = "processing";
    delete message.error;
  }
}
