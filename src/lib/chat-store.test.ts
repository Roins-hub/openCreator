import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

let root: string;
beforeAll(async () => {
  root = await mkdtemp(join(process.env.TMP || tmpdir(), "mote-chat-"));
  process.env.MOTE_STORAGE_ROOT = root;
  vi.resetModules();
});
afterAll(async () => { await rm(root, { recursive: true, force: true }); });

const alice = "0123456789abcdef0123456789abcdef";
const bob = "fedcba9876543210fedcba9876543210";

describe("chat store", () => {
  it("stores values per user and key", async () => {
    const store = await import("./chat-store");
    await store.setChatItem(alice, { key: "sub2chat:threads", value: "[1]" });
    await store.setChatItem(alice, { key: "sub2chat:messages:t1", value: "{\"messages\":[]}" });
    expect(await store.getChatItem(alice, "sub2chat:threads")).toBe("[1]");
    expect(await store.getChatItem(bob, "sub2chat:threads")).toBeNull();
    await store.removeChatItem(alice, "sub2chat:messages:t1");
    expect(await store.getChatItem(alice, "sub2chat:messages:t1")).toBeNull();
  });

  it("keeps the last of several quick writes to one key", async () => {
    const store = await import("./chat-store");
    await Promise.all(Array.from({ length: 6 }, (_, index) =>
      store.setChatItem(alice, { key: "sub2chat:messages:t2", value: String(index) })));
    expect(await store.getChatItem(alice, "sub2chat:messages:t2")).toBe("5");
  });

  it("returns when each chat was last written, only for the user's own keys", async () => {
    const store = await import("./chat-store");
    const before = Date.now() - 1000;
    await store.setChatItem(alice, { key: "sub2chat:messages:t3", value: "{}" });
    const times = await store.chatItemTimes(alice, ["sub2chat:messages:t3", "sub2chat:messages:none", "bad-key"]);
    expect(Object.keys(times)).toEqual(["sub2chat:messages:t3"]);
    expect(new Date(times["sub2chat:messages:t3"]).getTime()).toBeGreaterThan(before);
    expect(await store.chatItemTimes(bob, ["sub2chat:messages:t3"])).toEqual({});
    await store.removeChatItem(alice, "sub2chat:messages:t3");
  });

  it("rejects keys outside the chat namespace", async () => {
    const store = await import("./chat-store");
    await expect(store.setChatItem(alice, { key: "../../etc/passwd", value: "x" })).rejects.toThrow();
    await expect(store.getChatItem(alice, "other:key")).rejects.toThrow();
  });

  it("exports, replaces on import and clears", async () => {
    const store = await import("./chat-store");
    const before = await store.listChatItems(alice);
    expect(before.map((entry) => entry.key).sort()).toEqual(["sub2chat:messages:t2", "sub2chat:threads"]);
    expect(await store.importChatItems(alice, [{ key: "sub2chat:threads", value: "[2]" }])).toBe(1);
    expect(await store.listChatItems(alice)).toEqual([{ key: "sub2chat:threads", value: "[2]" }]);
    await expect(store.importChatItems(alice, [{ key: "bad", value: "x" }])).rejects.toThrow();
    await store.clearChatItems(alice);
    expect(await store.listChatItems(alice)).toEqual([]);
  });
});
