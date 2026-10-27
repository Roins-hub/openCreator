import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

let root: string;
beforeAll(async () => {
  root = await mkdtemp(join(process.env.TMP || tmpdir(), "mote-assets-folders-"));
  process.env.MOTE_STORAGE_ROOT = root;
  vi.resetModules();
});
afterAll(async () => { await rm(root, { recursive: true, force: true }); });

const owner = "abcdef1234567890abcdef1234567890";
const path = (name: string) => `users/${owner}/uploads/${name}`;

describe("asset names and folders", () => {
  it("renames, groups, moves and ungroups assets", async () => {
    const store = await import("./asset-store");
    for (const name of ["a.png", "b.png", "c.mp4"]) {
      await store.recordAsset(owner, {
        kind: name.endsWith(".mp4") ? "video" : "image", path: path(name), name, mimeType: "image/png", size: 1,
        createdAt: new Date().toISOString(), source: "upload",
      });
    }
    const byPath = async () => new Map((await store.listAssets(owner, [], [])).map((asset) => [asset.path, asset]));

    // 没写扩展名时沿用原来的
    expect(await store.renameAsset(owner, path("a.png"), " 古风女孩 ")).toBe("古风女孩.png");
    expect(await store.renameAsset(owner, path("b.png"), "cover.png")).toBe("cover.png");
    await expect(store.renameAsset(owner, path("a.png"), "  ")).rejects.toThrow("名称不能为空");

    // 拖到「新建分组」:建分组的同时移进去
    const people = await store.createAssetFolder(owner, "人物", [path("a.png"), path("c.mp4")]);
    expect((await store.listAssetFolders(owner)).map((folder) => folder.name)).toEqual(["人物"]);
    expect((await byPath()).get(path("c.mp4"))?.folder).toBe(people.id);

    const scenes = await store.createAssetFolder(owner, "场景");
    expect((await store.moveAssets(owner, [path("a.png"), path("b.png")], scenes.id)).sort()).toEqual([path("a.png"), path("b.png")]);
    await expect(store.moveAssets(owner, [path("a.png")], "missing")).rejects.toThrow("分组不存在");
    expect(await store.renameAssetFolder(owner, scenes.id, "场景图")).toBe("场景图");

    // 删除分组:素材回到未分组,不删除
    await store.deleteAssetFolder(owner, scenes.id);
    const assets = await byPath();
    expect([...assets.values()].map((asset) => [asset.name, asset.folder]).sort()).toEqual([
      ["c.mp4", people.id], ["cover.png", undefined], ["古风女孩.png", undefined],
    ]);
    expect(await store.moveAssets(owner, [path("c.mp4")], undefined)).toEqual([path("c.mp4")]);
    expect((await byPath()).get(path("c.mp4"))?.folder).toBeUndefined();

    // @ 选择素材的精简列表:不含回收站里的,只带需要的字段
    await store.moveAssets(owner, [path("a.png")], people.id);
    await store.setAssetsTrashed(owner, [path("b.png")], true);
    const picker = await store.listPickerAssets(owner);
    expect(picker.map((asset) => asset.name).sort()).toEqual(["c.mp4", "古风女孩.png"]);
    expect(picker.find((asset) => asset.path === path("a.png"))).toMatchObject({ id: path("a.png"), kind: "image", folder: people.id, source: "upload" });
    expect(Object.keys(picker[0])).not.toContain("prompt");

    // 聊天附件页的文件夹和工作台素材的分开列
    const chatFolder = await store.createAssetFolder(owner, "合同", [], "chat");
    expect((await store.listAssetFolders(owner)).map((item) => item.id)).not.toContain(chatFolder.id);
    expect((await store.listAssetFolders(owner, "chat")).map((item) => item.name)).toEqual(["合同"]);
  });
});
