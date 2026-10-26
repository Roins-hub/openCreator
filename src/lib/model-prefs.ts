import { z } from "zod";

/**
 * 模型选择里的「常用」:加星的模型和经常用的模型(同一类连续用同一个模型生成 3 次才加进来,只是点选不算)。按中转站账号保存在服务端
 * (data/users/<用户ID>/model-prefs.json),换电脑、换浏览器都一样。
 * 浏览器只发「做了什么」(用了 / 加星 / 移出 / 合并旧数据),服务端按顺序套用,几台设备同时改也不会互相覆盖。
 * 这里只放纯函数,浏览器和服务端都用。
 */
/** 连续用同一个模型生成的次数(视频、图片各算各的,来回切换不会打断) */
export interface UseStreak { id: string; count: number }
export interface ModelPrefs { favorites: string[]; recents: string[]; streaks?: Record<string, UseStreak> }

export const MAX_RECENTS = 8;
/** 连续生成几次后加进常用 */
export const RECENT_AFTER_USES = 3;
export const MAX_FAVORITES = 200;

export const emptyModelPrefs = (): ModelPrefs => ({ favorites: [], recents: [] });

const modelId = z.string().trim().min(1).max(200);

const kindSchema = z.enum(["video", "image"]);
const streakSchema = z.object({ id: modelId, count: z.number().int().min(1).max(999) });

export const modelPrefsSchema = z.object({
  favorites: z.array(modelId).max(MAX_FAVORITES),
  recents: z.array(modelId).max(MAX_RECENTS * 4),
  streaks: z.object({ video: streakSchema.optional(), image: streakSchema.optional() }).optional(),
});

export const modelPrefsOpSchema = z.discriminatedUnion("type", [
  /** 用这个模型生成了一次:连续第 3 次起加进常用(已在常用里的排到最前面) */
  z.object({ type: z.literal("use"), id: modelId, kind: kindSchema.optional() }),
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
    case "use": {
      const kind = op.kind || "video";
      const last = prefs.streaks?.[kind];
      const count = Math.min(999, last?.id === op.id ? last.count + 1 : 1);
      const promote = count >= RECENT_AFTER_USES || prefs.recents.includes(op.id);
      return {
        ...prefs,
        streaks: { ...prefs.streaks, [kind]: { id: op.id, count } },
        recents: promote ? [op.id, ...prefs.recents.filter((id) => id !== op.id)].slice(0, MAX_RECENTS) : prefs.recents,
      };
    }
    case "favorite":
      return {
        ...prefs,
        favorites: op.on
          ? unique([...prefs.favorites, op.id]).slice(-MAX_FAVORITES)
          : prefs.favorites.filter((id) => id !== op.id),
      };
    case "remove": {
      const drop = new Set(op.ids);
      // 移出后重新连续用够 3 次才会再回来
      const streaks = Object.fromEntries(Object.entries(prefs.streaks || {}).filter(([, streak]) => !drop.has(streak.id)));
      return {
        favorites: prefs.favorites.filter((id) => !drop.has(id)), recents: prefs.recents.filter((id) => !drop.has(id)),
        ...(Object.keys(streaks).length ? { streaks } : {}),
      };
    }
    case "merge":
      return {
        ...prefs,
        favorites: unique([...prefs.favorites, ...op.favorites]).slice(0, MAX_FAVORITES),
        recents: unique([...prefs.recents, ...op.recents]).slice(0, MAX_RECENTS),
      };
  }
}

export function parseModelPrefs(value: unknown): ModelPrefs {
  const parsed = modelPrefsSchema.safeParse(value);
  if (!parsed.success) return emptyModelPrefs();
  const { favorites, recents, streaks } = parsed.data;
  return {
    favorites: unique(favorites), recents: unique(recents).slice(0, MAX_RECENTS),
    ...(streaks && Object.keys(streaks).length ? { streaks: streaks as Record<string, UseStreak> } : {}),
  };
}
