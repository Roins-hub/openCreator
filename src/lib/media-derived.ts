import { inside } from "./paths";
import { userDir } from "./identity";
import { readJson, writeJsonAtomic } from "./json-store";
import {
  deleteDerived, derivedKey, fetchProcessed, mediaProcessing, putDerived, thumbProcess, type DerivedVariant,
} from "./object-store";

/**
 * 预先生成、保存好的缩略图和大图(火山 TOS 现场处理不缓存结果,大图每次都要等 1–3 秒):
 * - w480:列表、卡片里的缩略图(视频是首帧截图);w1080:大一点的卡片;
 * - view:放大查看用的大图,原尺寸 WebP(17MB 的 PNG 只有约 500KB),下载仍是原文件。
 * 新图片 / 视频入库时就在后台生成 w480 和 view;旧的第一次被看时先现场处理,同时在后台生成保存,下次直接用。
 * 哪些已经生成过记在用户目录的 derived.json 里(不用每次去云存储查)。
 */
export type { DerivedVariant };

const IMAGE_EXT = /\.(png|jpe?g|webp|bmp)$/i;
const VIEW_PROCESS = "image/format,webp/quality,q_90";

/** 这个规格的处理参数;undefined:直接用原文件;null:没有(存储不支持处理的视频缩略图) */
export function variantProcess(key: string, variant: DerivedVariant): string | undefined | null {
  if (variant === "view") return IMAGE_EXT.test(key) && mediaProcessing() ? VIEW_PROCESS : undefined;
  return thumbProcess(key, variant === "w480" ? 480 : 1080);
}

export const variantForWidth = (width: number): DerivedVariant => width <= 480 ? "w480" : "w1080";

// ---- 已生成的清单(每个用户一份,内存里缓存,改了延迟写盘) ----
const indexFile = (userId: string) => inside(userDir(userId), "derived.json");
const MAX_ENTRIES = 50_000;
const indexes = new Map<string, Promise<Set<string>>>();
const saveTimers = new Map<string, ReturnType<typeof setTimeout>>();
const userOf = (key: string) => key.split("/")[1];
const entry = (key: string, variant: DerivedVariant) => `${variant}:${key}`;

function index(userId: string) {
  let value = indexes.get(userId);
  if (!value) {
    value = readJson<unknown>(indexFile(userId), []).then((list) =>
      new Set(Array.isArray(list) ? list.filter((item): item is string => typeof item === "string") : []));
    indexes.set(userId, value);
  }
  return value;
}

function persist(userId: string) {
  clearTimeout(saveTimers.get(userId));
  saveTimers.set(userId, setTimeout(() => {
    saveTimers.delete(userId);
    void index(userId).then((set) => writeJsonAtomic(indexFile(userId), [...set].slice(-MAX_ENTRIES))).catch(() => undefined);
  }, 1000));
}

export async function hasDerived(key: string, variant: DerivedVariant) {
  return (await index(userOf(key))).has(entry(key, variant));
}

// ---- 后台生成:最多同时两个,同一个不重复排队 ----
const queued = new Set<string>();
const tasks: (() => Promise<void>)[] = [];
let running = 0;
function pump() {
  while (running < 2 && tasks.length) {
    const task = tasks.shift()!;
    running += 1;
    void task().finally(() => { running -= 1; pump(); });
  }
}

/** 没生成过就排队生成(出错只记日志,不影响页面:下次再看还会现场处理) */
export function ensureDerived(key: string, variant: DerivedVariant) {
  const process = variantProcess(key, variant);
  if (!process) return;
  const id = entry(key, variant);
  if (queued.has(id)) return;
  queued.add(id);
  tasks.push(async () => {
    try {
      const set = await index(userOf(key));
      if (set.has(id)) return;
      const { body, contentType } = await fetchProcessed(key, process);
      await putDerived(derivedKey(key, variant), body, contentType);
      set.add(id);
      persist(userOf(key));
    } catch (error) {
      console.warn(`[mote] 生成${variant}失败:`, (error as Error).message);
    } finally {
      queued.delete(id);
    }
  });
  pump();
}

/** 新图片 / 视频入库:先把缩略图(图片还有卡片用的 1080 档和放大查看的大图)生成好 */
export function prepareDerived(key: string, kind: string) {
  if (!mediaProcessing()) return;
  if (kind === "image") { ensureDerived(key, "w480"); ensureDerived(key, "w1080"); ensureDerived(key, "view"); }
  else if (kind === "video") ensureDerived(key, "w480");
}

/** 原文件永久删除时,生成件也一起删掉 */
export async function dropDerived(keys: readonly string[]) {
  for (const key of keys) {
    const set = await index(userOf(key)).catch(() => undefined);
    if (!set) continue;
    for (const variant of ["w480", "w1080", "view"] as const) {
      const id = entry(key, variant);
      if (!set.has(id)) continue;
      await deleteDerived(derivedKey(key, variant)).catch(() => undefined);
      set.delete(id);
    }
    persist(userOf(key));
  }
}
