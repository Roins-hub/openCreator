import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

let root: string;
beforeAll(async () => {
  root = await mkdtemp(join(process.env.TMP || tmpdir(), "mote-assets-"));
  process.env.MOTE_STORAGE_ROOT = root;
  vi.resetModules();
});
afterAll(async () => { await rm(root, { recursive: true, force: true }); });

describe("concurrent asset records", () => {
  it("keeps every record when several results finish at once", async () => {
    const { recordAsset, listAssets } = await import("./asset-store");
    const owner = "abcdefabcdefabcdefabcdefabcdef12";
    await Promise.all(Array.from({ length: 6 }, (_, index) => recordAsset(owner, {
      kind: "image", path: `users/${owner}/images/${index}.png`, name: `${index}.png`, mimeType: "image/png",
      size: 1, createdAt: new Date().toISOString(),
    })));
    expect(await listAssets(owner, [], [])).toHaveLength(6);
  });
});
