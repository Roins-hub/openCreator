import { describe, expect, it } from "vitest";
import { unfinishedTaskIds } from "./generation-stop";

describe("unfinishedTaskIds", () => {
  it("returns only video tasks that have not reached a terminal state", () => {
    expect(unfinishedTaskIds({
      id: "message-1",
      role: "assistant",
      content: "",
      createdAt: "2026-07-23T00:00:00.000Z",
      status: "processing",
      taskIds: ["task-1", "task-2", "task-3"],
      completedTaskIds: ["task-1"],
      failedTaskIds: ["task-2"],
    })).toEqual(["task-3"]);
  });

  it("supports the legacy single task id", () => {
    expect(unfinishedTaskIds({
      id: "message-1",
      role: "assistant",
      content: "",
      createdAt: "2026-07-23T00:00:00.000Z",
      status: "processing",
      taskId: "task-1",
    })).toEqual(["task-1"]);
  });
});
