import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// 假的中转站数据库:账号 7 有一个在用的 Key 和一个已删除的 Key,账号 8 有一个 Key
const tokens = [
  { key: "live7", account: "7", active: true },
  { key: "gone7", account: "7", active: false },
  { key: "live8", account: "8", active: true },
];
vi.mock("./relay-accounts", () => ({
  relayAccounts: () => ({
    accountOfKey: async (key: string) => tokens.find((t) => t.active && `sk-${t.key}` === key)?.account ?? null,
    keysOfAccount: async (account: string) => tokens.filter((t) => t.account === account).map((t) => t.key),
  }),
}));

let root: string;
const request = (key: string) => new Request("https://vip.example/api", { headers: { "x-tangzhi-key": key } });
const now = "2026-10-12T00:00:00.000Z";

beforeAll(async () => {
  root = await mkdtemp(join(process.env.TMP || tmpdir(), "mote-account-"));
  process.env.MOTE_STORAGE_ROOT = root;
  process.env.MOTE_SESSION_SECRET = "test-secret-test-secret-test-secret";
});
beforeEach(() => vi.resetModules());
afterAll(async () => { await rm(root, { recursive: true, force: true }); });

async function legacyWorkspace(id: string, conversationId: string, extra: Record<string, unknown> = {}) {
  const dir = join(root, "data", "users", id);
  await mkdir(join(dir, "conversations"), { recursive: true });
  await writeFile(join(dir, "profile.json"), JSON.stringify({ createdAt: now }));
  await writeFile(join(dir, "conversations", `${conversationId}.json`), JSON.stringify({
    id: conversationId, title: conversationId, createdAt: now, updatedAt: now, messages: [],
  }));
  for (const [file, value] of Object.entries(extra)) await writeFile(join(dir, file), JSON.stringify(value));
}

describe("isolation by relay account", () => {
  it("merges every old per-key workspace of the account, including deleted keys", async () => {
    const { userIdOf, accountUserId } = await import("./identity");
    const liveId = userIdOf("sk-live7");
    const goneId = userIdOf("sk-gone7");
    await legacyWorkspace(liveId, "from-live", {
      "favorites.json": [`users/${liveId}/videos/a.mp4`],
      "assets.json": [{ path: `users/${liveId}/videos/a.mp4`, kind: "video", name: "a", mimeType: "video/mp4", size: 1, createdAt: now }],
    });
    await legacyWorkspace(goneId, "from-deleted-key", {
      "prompts.json": [{ id: "mine-1", title: "旧提示词", prompt: "x", tags: [], category: "mine" }],
    });
    await legacyWorkspace(userIdOf("sk-live8"), "other-account");

    const { requireUser, ownsMedia } = await import("./identity");
    const { listConversations } = await import("./conversation-store");
    const { listCustomPrompts } = await import("./custom-prompt-store");
    const { userId } = await requireUser(request("sk-live7"));
    expect(userId).toBe(accountUserId("7"));
    expect((await listConversations(userId)).map((item) => item.id).sort()).toEqual(["from-deleted-key", "from-live"]);
    expect((await listCustomPrompts(join(root, "data", "users", userId))).map((item) => item.id)).toEqual(["mine-1"]);
    // 旧空间的视频仍归这个账号,别人的不行
    expect(await ownsMedia(userId, `users/${liveId}/videos/a.mp4`)).toBe(true);
    expect(await ownsMedia(userId, `users/${goneId}/uploads/b.png`)).toBe(true);
    expect(await ownsMedia(userId, `users/${userIdOf("sk-live8")}/videos/c.mp4`)).toBe(false);
    // 旧目录移进了备份,另一个账号的数据没动
    const users = await readdir(join(root, "data", "users"));
    expect(users).not.toContain(liveId);
    expect(users).toContain(userIdOf("sk-live8"));
    expect((await readdir(join(root, "data", "merged-workspaces"))).length).toBe(2);
  });

  it("rejects deleted or unknown keys", async () => {
    const { requireUser } = await import("./identity");
    await expect(requireUser(request("sk-gone7"))).rejects.toThrow(/无效、已删除/);
    await expect(requireUser(request("sk-nope"))).rejects.toThrow(/无效、已删除/);
  });

  it("gives a new key of the same account the same workspace", async () => {
    tokens.push({ key: "new7", account: "7", active: true });
    const { requireUser, accountUserId } = await import("./identity");
    const { listConversations } = await import("./conversation-store");
    const { userId } = await requireUser(request("sk-new7"));
    expect(userId).toBe(accountUserId("7"));
    expect((await listConversations(userId)).length).toBe(2);
  });
});
