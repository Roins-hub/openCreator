import { resolve } from "node:path";
import { readJson, writeJsonAtomic } from "./json-store";

/** 收藏按媒体 key 记录,存在每个用户自己的目录里(root = data/users/<用户ID>)。 */
const favoritesFile = (root: string) => resolve(root, "favorites.json");

export async function listFavorites(root: string): Promise<string[]> {
  const value = await readJson<unknown>(favoritesFile(root), []);
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

export async function setFavorite(path: string, favorite: boolean, root: string, prefixes: string | string[] = "") {
  if (![prefixes].flat().some((prefix) => path.startsWith(prefix)) || !/^users\/[0-9a-f]{32}\/videos\/[^/]+$/.test(path)) throw new Error("非法资产路径");
  const current = await listFavorites(root);
  const next = favorite
    ? [path, ...current.filter((item) => item !== path)]
    : current.filter((item) => item !== path);
  await writeJsonAtomic(favoritesFile(root), next);
  return next;
}
