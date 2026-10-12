import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

let root: string;
beforeAll(async () => {
  root = await mkdtemp(join(process.env.TMP || tmpdir(), "mote-store-"));
  process.env.MOTE_STORAGE_ROOT = root;
  vi.resetModules();
});
afterAll(async () => { await rm(root, { recursive: true, force: true }); });

const user = "0123456789abcdef0123456789abcdef";

describe("conversation store", () => {
  it("does not lose messages when several generations update one conversation at once", async () => {
    const { getConversation, saveConversation, updateConversation } = await import("./conversation-store");
    const now = new Date().toISOString();
    await saveConversation(user, { id: "c1", title: "t", createdAt: now, updatedAt: now, messages: [] });
    await Promise.all(Array.from({ length: 8 }, (_, index) => updateConversation(user, "c1", async (conversation) => {
      await new Promise((resolve) => setTimeout(resolve, 8 - index));
      conversation.messages.push({ id: `a${index}`, role: "assistant", content: "", createdAt: now, status: "processing" });
    })));
    const stale = { id: "c1", title: "renamed", createdAt: now, updatedAt: now, messages: [] };
    await saveConversation(user, stale);
    const saved = await getConversation(user, "c1");
    expect(saved?.title).toBe("renamed");
    expect(saved?.messages.map((item) => item.id).sort()).toEqual(["a0", "a1", "a2", "a3", "a4", "a5", "a6", "a7"]);
    await saveConversation(user, stale, ["a3"]);
    expect((await getConversation(user, "c1"))?.messages).toHaveLength(7);
  });
});
