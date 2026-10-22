import { z } from "zod";

/**
 * 模型选择里的「常用」:加星的模型和最近用过的模型。按中转站账号保存在服务端
 * (data/users/<用户ID>/model-prefs.json),换电脑、换浏览器都一样。
 * 浏览器只发「做了什么」(用了 / 加星 / 移出 / 合并旧数据),服务端按顺序套用,几台设备同时改也不会互相覆盖。
 * 这里只放纯函数,浏览器和服务端都用。
 */
export interface ModelPrefs { favorites: string[]; recents: string[] }

export const MAX_RECENTS = 8;
export const MAX_FAVORITES = 200;

export const emptyModelPrefs = (): ModelPrefs => ({ favorites: [], recents: [] });

const modelId = z.string().trim().min(1).max(200);

export const modelPrefsSchema = z.object({
  favorites: z.array(modelId).max(MAX_FAVORITES),
  recents: z.array(modelId).max(MAX_RECENTS * 4),
});

export const modelPrefsOpSchema = z.discriminatedUnion("type", [
  /** 选用了一个模型:排到最近用过的最前面 */
  z.object({ type: z.literal("use"), id: modelId }),
  z.object({ type: z.literal("favorite"), id: modelId, on: z.boolean() }),
  /** 移出常用:加星的取消星标,最近用过的删掉 */
  z.object({ type: z.literal("remove"), ids: z.array(modelId).max(500) }),
  /** 把这台浏览器以前存在本地的常用并进来(只做一次) */
  z.object({ type: z.literal("merge"), favorites: z.array(modelId).max(MAX_FAVORITES), recents: z.array(modelId).max(MAX_RECENTS * 4) }),
]);
export type ModelPrefsOp = z.infer<typeof modelPrefsOpSchema>;

const unique = (list: readonly string[]) => [...new Set(list)];

export function applyModelPrefsOp(prefs: ModelPrefs, op: ModelPrefsOp): ModelPrefs {
  switch (op.type) {
    case "use":
      return { ...prefs, recents: [op.id, ...prefs.recents.filter((id) => id !== op.id)].slice(0, MAX_RECENTS) };
    case "favorite":
      return {
        ...prefs,
        favorites: op.on
          ? unique([...prefs.favorites, op.id]).slice(-MAX_FAVORITES)
          : prefs.favorites.filter((id) => id !== op.id),
      };
    case "remove": {
      const drop = new Set(op.ids);
      return { favorites: prefs.favorites.filter((id) => !drop.has(id)), recents: prefs.recents.filter((id) => !drop.has(id)) };
    }
    case "merge":
      return {
        favorites: unique([...prefs.favorites, ...op.favorites]).slice(0, MAX_FAVORITES),
        recents: unique([...prefs.recents, ...op.recents]).slice(0, MAX_RECENTS),
      };
  }
}

export function parseModelPrefs(value: unknown): ModelPrefs {
  const parsed = modelPrefsSchema.safeParse(value);
  return parsed.success
    ? { favorites: unique(parsed.data.favorites), recents: unique(parsed.data.recents).slice(0, MAX_RECENTS) }
    : emptyModelPrefs();
}
