import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { favoriteKey, listFavorites, setFavorite } from "./favorite-store";

let root = "";
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), "mote-fav-")); });
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

describe("favorite-store", () => {
  it("starts empty when no file exists", async () => {
    expect(await listFavorites(root)).toEqual([]);
  });

  it("adds, dedupes and removes favorites", async () => {
    await setFavorite("videos/a.mp4", true, root);
    await setFavorite("images/b.png", true, root);
    await setFavorite("videos/a.mp4", true, root);
    expect(await listFavorites(root)).toEqual(["videos/a.mp4", "images/b.png"]);
    await setFavorite("videos/a.mp4", false, root);
    expect(await listFavorites(root)).toEqual(["images/b.png"]);
  });

  it("keys trashed assets by their original path", async () => {
    expect(favoriteKey(".trash/videos/a.mp4")).toBe("videos/a.mp4");
    await setFavorite(".trash/videos/a.mp4", true, root);
    expect(await listFavorites(root)).toEqual(["videos/a.mp4"]);
  });

  it("rejects paths outside the asset folders", async () => {
    await expect(setFavorite("../config.json", true, root)).rejects.toThrow("非法资产路径");
    await expect(setFavorite("uploads/x.png", true, root)).rejects.toThrow("非法资产路径");
  });
});
