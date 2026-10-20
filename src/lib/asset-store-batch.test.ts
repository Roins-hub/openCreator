import { mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

let root: string;
beforeAll(async () => {
  root = await mkdtemp(join(process.env.TMP || tmpdir(), "mote-assets-batch-"));
  process.env.MOTE_STORAGE_ROOT = root;
  vi.resetModules();
});
afterAll(async () => { await rm(root, { recursive: true, force: true }); });

const owner = "1234567890abcdef1234567890abcdef";
const path = (name: string) => `users/${owner}/uploads/${name}`;

describe("batch asset operations", () => {
  it("trashes, restores and permanently deletes several assets at once", async () => {
    const { recordAsset, listAssets, setAssetsTrashed, permanentlyDeleteAssets } = await import("./asset-store");
    const { outDir } = await import("./paths");
    for (const name of ["a.png", "b.png", "c.mp3"]) {
      const file = join(outDir, path(name));
      await mkdir(dirname(file), { recursive: true });
      await writeFile(file, "x");
      await recordAsset(owner, {
        kind: name.endsWith(".mp3") ? "audio" : "image", path: path(name), name, mimeType: "image/png", size: 1,
        createdAt: new Date().toISOString(), source: "upload",
      });
    }

    expect((await setAssetsTrashed(owner, [path("a.png"), path("b.png")], true)).sort()).toEqual([path("a.png"), path("b.png")]);
    // 已在回收站的跳过,不报错
    expect(await setAssetsTrashed(owner, [path("a.png"), path("c.mp3")], true)).toEqual([path("c.mp3")]);
    expect((await listAssets(owner, [], [])).every((asset) => asset.trashed)).toBe(true);
    expect(await setAssetsTrashed(owner, [path("c.mp3")], false)).toEqual([path("c.mp3")]);

    const result = await permanentlyDeleteAssets(owner, [path("a.png"), path("b.png"), path("missing.png")]);
    expect({ ...result, deleted: result.deleted.sort() }).toEqual({ deleted: [path("a.png"), path("b.png")], failed: [] });
    await expect(stat(join(outDir, path("a.png")))).rejects.toThrow();
    const left = await listAssets(owner, [], []);
    expect(left.map((asset) => [asset.name, asset.source, asset.trashed])).toEqual([["c.mp3", "upload", undefined]]);

    await expect(setAssetsTrashed(owner, [path("nope.png")], true)).rejects.toThrow("资产不存在");
  });
});
