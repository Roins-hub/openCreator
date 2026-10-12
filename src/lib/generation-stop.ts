import type { Message } from "./types";

export function unfinishedTaskIds(message: Message) {
  const taskIds = message.taskIds?.length ? message.taskIds :
    message.taskId ? [message.taskId] : [];
  const terminal = new Set([
    ...(message.completedTaskIds || []),
    ...(message.failedTaskIds || []),
  ]);
  return taskIds.filter((taskId) => !terminal.has(taskId));
}
