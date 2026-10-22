import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// 验证 Key 时请求 /v1/models:一律当作可用
vi.mock("./relay", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./relay")>()),
  relayFetch: async () => Response.json({ data: [] }),
}));

let root: string;
beforeAll(async () => {
  root = await mkdtemp(join(process.env.TMP || tmpdir(), "mote-account-"));
  process.env.MOTE_STORAGE_ROOT = root;
  delete process.env.RELAY_DB_URL;
  vi.resetModules();
});
afterAll(async () => { await rm(root, { recursive: true, force: true }); });

const request = (headers: Record<string, string>) => new Request("https://vip.example/api/x", { headers });

describe("main key on a custom relay", () => {
  it("stores data by the main key whatever video key is used", async () => {
    const { requireUser } = await import("./identity");
    const base = "https://relay.example.com";
    const byMain = await requireUser(request({ "x-tangzhi-key": "sk-main", "x-tangzhi-base": base }));
    const withVideoKey = await requireUser(request({ "x-tangzhi-key": "sk-video", "x-tangzhi-base": base, "x-tangzhi-account-key": "sk-main" }));
    expect(withVideoKey.userId).toBe(byMain.userId);
    // 调用中转站仍用视频的 Key
    expect(withVideoKey.apiKey).toBe("sk-video");
    const videoOnly = await requireUser(request({ "x-tangzhi-key": "sk-video", "x-tangzhi-base": base }));
    expect(videoOnly.userId).not.toBe(byMain.userId);
  });

  it("is ignored on the default relay", async () => {
    const { requireUser } = await import("./identity");
    const plain = await requireUser(request({ "x-tangzhi-key": "sk-video" }));
    const withMain = await requireUser(request({ "x-tangzhi-key": "sk-video", "x-tangzhi-account-key": "sk-main" }));
    expect(withMain.userId).toBe(plain.userId);
  });
});
