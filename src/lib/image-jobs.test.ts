import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { ImageModel } from "./image-models";

const relayCalls = vi.hoisted(() => ({ generate: [] as unknown[], edit: [] as FormData[] }));
const outcome = vi.hoisted(() => ({ fail: "" }));

vi.mock("./tangzhi-server", () => ({
  generateImage: vi.fn(async (_key: string, body: unknown) => {
    relayCalls.generate.push(body);
    if (outcome.fail) throw new Error(outcome.fail);
    return { bytes: new Uint8Array([137, 80, 78, 71]), mimeType: "image/png" };
  }),
  editImage: vi.fn(async (_key: string, form: FormData) => {
    relayCalls.edit.push(form);
    return { bytes: new Uint8Array([1, 2, 3]), mimeType: "image/webp" };
  }),
}));

let root: string;
beforeAll(async () => {
  root = await mkdtemp(join(process.env.TMP || tmpdir(), "mote-image-"));
  process.env.MOTE_STORAGE_ROOT = root;
  vi.resetModules();
});
afterAll(async () => { await rm(root, { recursive: true, force: true }); });
beforeEach(() => {
  relayCalls.generate.length = 0;
  relayCalls.edit.length = 0;
  outcome.fail = "";
});

const user = "0123456789abcdef0123456789abcdef";
const model: ImageModel = {
  type: "image", id: "gpt-image-2", api: "images", tag: "", description: "", price: { kind: "unknown" }, priceLabel: "按量计费", priceDetail: "按量计费", maxReferences: 4, promptMax: 6000,
  vendor: "OpenAI", series: "GPT Image 2",
};
const options = { ratio: "16:9", resolution: "2k", background: "auto", format: "png", count: 2 } as const;

async function setup(conversationId: string, taskIds: string[], createdAt = new Date().toISOString()) {
  const store = await import("./conversation-store");
  await store.saveConversation(user, {
    id: conversationId, title: "t", createdAt, updatedAt: createdAt,
    messages: [{
      id: "a1", role: "assistant", content: "", createdAt, status: "processing",
      taskId: taskIds[0], taskIds, completedTaskIds: [], failedTaskIds: [],
    }],
  });
  return store;
}

async function settled(conversationId: string, done: (status: string) => boolean) {
  const { getConversation } = await import("./conversation-store");
  // 全量测试并行跑时机器较忙,最多等 10 秒
  for (let i = 0; i < 500; i++) {
    const message = (await getConversation(user, conversationId))?.messages[0];
    if (message && done(message.status)) return message;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("job did not finish");
}

describe("background image jobs", { timeout: 20_000 }, () => {
  it("generates each image, stores it and completes the record when all tasks finish", async () => {
    const { startImageJob, newImageTaskId } = await import("./image-jobs");
    const ids = [newImageTaskId(), newImageTaskId()];
    await setup("c1", ids);
    for (const taskId of ids) {
      startImageJob({ userId: user, apiKey: "k", relay: { base: "https://new.tangzhi.org", custom: false },
        conversationId: "c1", taskId, model, prompt: "海边的灯塔", options, references: [] });
    }
    const message = await settled("c1", (status) => status === "complete");
    expect(message.media).toHaveLength(2);
    expect(message.media?.every((item) => item.kind === "image" && item.path.startsWith(`users/${user}/images/`))).toBe(true);
    expect(message.completedTaskIds?.sort()).toEqual([...ids].sort());
    expect(message.elapsedMs).toBeGreaterThanOrEqual(0);
    expect(relayCalls.generate[0]).toMatchObject({ model: "gpt-image-2", size: "2048x1152", output_format: "png", n: 1 });
    expect(relayCalls.generate[0]).not.toHaveProperty("quality");
    expect(String((relayCalls.generate[0] as { prompt: string }).prompt)).toContain("16:9，横版");
    // 资产记录在写回对话之后才登记,等两条都写完
    const { listAssets } = await import("./asset-store");
    let images: unknown[] = [];
    for (let i = 0; i < 50 && images.length < 2; i++) {
      images = (await listAssets(user, [], [])).filter((asset) => asset.kind === "image");
      if (images.length < 2) await new Promise((resolve) => setTimeout(resolve, 20));
    }
    expect(images).toHaveLength(2);
  });

  it("sends reference images to the edits endpoint", async () => {
    const { putObject } = await import("./object-store");
    const reference = { kind: "image" as const, path: `users/${user}/uploads/ref.png`, name: "ref.png", mimeType: "image/png" };
    await putObject(reference.path, new Uint8Array([9, 9, 9]), "image/png");
    const { startImageJob, newImageTaskId } = await import("./image-jobs");
    const id = newImageTaskId();
    await setup("c2", [id]);
    startImageJob({ userId: user, apiKey: "k", relay: { base: "https://new.tangzhi.org", custom: false },
      conversationId: "c2", taskId: id, model, prompt: "换成夜景", options: { ...options, count: 1 }, references: [reference] });
    const message = await settled("c2", (status) => status === "complete");
    expect(relayCalls.edit).toHaveLength(1);
    expect(relayCalls.edit[0].get("model")).toBe("gpt-image-2");
    expect(relayCalls.edit[0].get("image")).toBeInstanceOf(Blob);
    expect(message.media?.[0].name).toMatch(/\.webp$/);
  });

  it("records the relay error on the card", async () => {
    outcome.fail = "中转站余额不足";
    const { startImageJob, newImageTaskId } = await import("./image-jobs");
    const id = newImageTaskId();
    await setup("c3", [id]);
    startImageJob({ userId: user, apiKey: "k", relay: { base: "https://new.tangzhi.org", custom: false },
      conversationId: "c3", taskId: id, model, prompt: "灯塔", options: { ...options, count: 1 }, references: [] });
    const message = await settled("c3", (status) => status === "failed");
    expect(message.error).toBe("中转站余额不足");
  });

  it("fails tasks that were lost in a restart, but only after a grace period", async () => {
    const { checkImageTask } = await import("./image-jobs");
    await setup("c4", ["img.fresh"]);
    expect((await checkImageTask(user, "c4", "img.fresh")).messages[0].status).toBe("processing");
    await setup("c5", ["img.lost"], new Date(Date.now() - 5 * 60_000).toISOString());
    const message = (await checkImageTask(user, "c5", "img.lost")).messages[0];
    expect(message.status).toBe("failed");
    expect(message.error).toContain("服务重启");
  });
});
