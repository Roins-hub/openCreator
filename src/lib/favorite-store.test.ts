import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { listFavorites, setFavorite } from "./favorite-store";

const user = "0123456789abcdef0123456789abcdef";
const video = (name: string) => `users/${user}/videos/${name}`;
let root = "";
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), "mote-fav-")); });
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

describe("favorite-store", () => {
  it("starts empty when no file exists", async () => {
    expect(await listFavorites(root)).toEqual([]);
  });

  it("adds, dedupes and removes favorites", async () => {
    await setFavorite(video("a.mp4"), true, root);
    await setFavorite(video("b.mp4"), true, root);
    await setFavorite(video("a.mp4"), true, root);
    expect(await listFavorites(root)).toEqual([video("a.mp4"), video("b.mp4")]);
    await setFavorite(video("a.mp4"), false, root);
    expect(await listFavorites(root)).toEqual([video("b.mp4")]);
  });

  it("rejects paths outside the user's own media", async () => {
    await expect(setFavorite("../config.json", true, root)).rejects.toThrow("非法资产路径");
    await expect(setFavorite(video("a.mp4"), true, root, "users/ffffffffffffffffffffffffffffffff/")).rejects.toThrow();
  });
});
