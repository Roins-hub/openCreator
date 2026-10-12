import { copyFile, mkdir, readdir, rename, stat } from "node:fs/promises";
import { dataDir, inside } from "./paths";
import { readJson, writeJsonAtomic } from "./json-store";

/**
 * 把一个旧空间(以前按 API Key 隔离时的 data/users/<Key 指纹>)合并进账号空间。
 * - 对话按 ID 合并,同一 ID 保留更新时间较新的那份;
 * - 资产索引、收藏、自定义提示词取并集;
 * - 账号 profile.json 记下 mergedFrom,旧空间的媒体(对象存储 users/<旧 ID>/...)继续归这个账号访问;
 * - 合并完成后旧目录整体移到 data/merged-workspaces/ 留作备份,不再被任何 Key 使用。
 */
export interface Profile {
  createdAt: string;
  accountId?: string;
  mergedFrom?: string[];
}

const workspace = (id: string) => inside(dataDir, "users", id);
const exists = (path: string) => stat(path).then(() => true, () => false);
const list = async <T>(path: string) => {
  const value = await readJson<unknown>(path, []);
  return Array.isArray(value) ? value as T[] : [];
};

async function unionFile<T>(from: string, to: string, file: string, keyOf: (item: T) => string) {
  const incoming = await list<T>(inside(from, file));
  if (!incoming.length) return;
  const current = await list<T>(inside(to, file));
  const seen = new Set(current.map(keyOf));
  await writeJsonAtomic(inside(to, file), [...current, ...incoming.filter((item) => !seen.has(keyOf(item)))]);
}

export async function readProfile(id: string) {
  return readJson<Profile | null>(inside(workspace(id), "profile.json"), null);
}

export async function writeProfile(id: string, profile: Profile) {
  await writeJsonAtomic(inside(workspace(id), "profile.json"), profile);
}

export async function mergeWorkspace(fromId: string, toId: string) {
  if (fromId === toId) return false;
  const from = workspace(fromId);
  const to = workspace(toId);
  if (!(await exists(from))) return false;
  await mkdir(inside(to, "conversations"), { recursive: true });

  const sourceConversations = inside(from, "conversations");
  const files = (await exists(sourceConversations)) ? await readdir(sourceConversations) : [];
  for (const file of files.filter((name) => name.endsWith(".json"))) {
    const source = inside(sourceConversations, file);
    const target = inside(to, "conversations", file);
    const [incoming, current] = await Promise.all([
      readJson<{ updatedAt?: string } | null>(source, null),
      readJson<{ updatedAt?: string } | null>(target, null),
    ]);
    if (!incoming) continue;
    if (!current || (incoming.updatedAt || "") > (current.updatedAt || "")) await copyFile(source, target);
  }
  await unionFile<{ path: string }>(from, to, "assets.json", (item) => item.path);
  await unionFile<string>(from, to, "favorites.json", (item) => item);
  await unionFile<{ id: string }>(from, to, "prompts.json", (item) => item.id);

  const fromProfile = await readProfile(fromId);
  const profile = await readProfile(toId) || { createdAt: new Date().toISOString() };
  profile.mergedFrom = [...new Set([...(profile.mergedFrom || []), fromId, ...(fromProfile?.mergedFrom || [])])];
  if (fromProfile?.createdAt && fromProfile.createdAt < profile.createdAt) profile.createdAt = fromProfile.createdAt;
  await writeProfile(toId, profile);

  const backup = inside(dataDir, "merged-workspaces");
  await mkdir(backup, { recursive: true });
  await rename(from, inside(backup, `${fromId}-${Date.now()}`));
  return true;
}
