import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Conversation } from "@/lib/types";

const state = vi.hoisted(() => ({ conversation: undefined as unknown as Conversation }));
const deleteObject = vi.hoisted(() => vi.fn(async () => undefined));
const recordAsset = vi.hoisted(() => vi.fn(async () => undefined));

vi.mock("@/lib/identity", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/identity")>()),
  requireUser: async () => ({ apiKey: "k", userId: "a".repeat(32), relay: {} }),
}));
vi.mock("@/lib/object-store", () => ({ putObject: async () => undefined, deleteObject }));
vi.mock("@/lib/asset-store", () => ({ recordAsset }));
vi.mock("@/lib/tangzhi-server", () => ({
  decodeTaskId: (id: string) => id.replace(/^tz\./, ""),
  queryVideoTask: async () => ({ status: "succeeded", elapsedMs: 1000 }),
  // 下载慢一点,让两个请求共用同一次下载
  downloadVideo: () => new Promise((resolve) => setTimeout(() => resolve(new Uint8Array(10)), 20)),
}));
vi.mock("@/lib/conversation-store", () => ({
  getConversation: async () => structuredClone(state.conversation),
  updateConversation: async (_user: string, _id: string, change: (latest: Conversation) => void) => {
    change(state.conversation);
    return structuredClone(state.conversation);
  },
}));

import { GET } from "./route";

describe("video task polling", () => {
  beforeEach(() => {
    deleteObject.mockClear();
    recordAsset.mockClear();
    state.conversation = {
      id: "c1", title: "t", createdAt: "2026-10-21T00:00:00.000Z", updatedAt: "2026-10-21T00:00:00.000Z",
      messages: [{ id: "m1", role: "assistant", status: "processing", taskId: "tz.task_1", createdAt: "2026-10-21T00:00:00.000Z" }],
    } as unknown as Conversation;
  });

  it("keeps the video when two requests finish the same task at once", async () => {
    const call = () => GET(new Request("http://x/api/tasks/tz.task_1?conversationId=c1"), { params: Promise.resolve({ id: "tz.task_1" }) });
    const responses = await Promise.all([call(), call()]);
    expect(await Promise.all(responses.map((response) => response.ok ? "ok" : response.text()))).toEqual(["ok", "ok"]);
    expect(recordAsset).toHaveBeenCalledTimes(1);
    expect(deleteObject).not.toHaveBeenCalled();
    expect(JSON.stringify(state.conversation)).toContain("/videos/");
  });
});
