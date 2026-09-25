import { resolve } from "node:path";
import { dataDir } from "./paths";
import { readJson, writeJsonAtomic } from "./json-store";

const favoritesFile = (root = dataDir) => resolve(root, "favorites.json");

/** 收藏按资产原始路径记录,移入回收站再恢复后收藏状态不丢失。 */
export function favoriteKey(path: string) {
  return path.replace(/^\.trash\//, "");
}

export async function listFavorites(root = dataDir): Promise<string[]> {
  const value = await readJson<unknown>(favoritesFile(root), []);
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

export async function setFavorite(path: string, favorite: boolean, root = dataDir) {
  const key = favoriteKey(path);
  if (!/^(images|videos)\/[^/]+$/.test(key)) throw new Error("非法资产路径");
  const current = await listFavorites(root);
  const next = favorite
    ? [key, ...current.filter((item) => item !== key)]
    : current.filter((item) => item !== key);
  await writeJsonAtomic(favoritesFile(root), next);
  return next;
}
