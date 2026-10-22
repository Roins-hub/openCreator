"use client";

import { apiKeyHeaders, customAccountKey, readApiKey, readRelayBase } from "./api-key";
import { applyModelPrefsOp, emptyModelPrefs, parseModelPrefs, type ModelPrefs, type ModelPrefsOp } from "./model-prefs";

/**
 * 浏览器这边的「常用」:以服务端(按中转站账号)为准,本地按账号缓存一份,打开面板时先显示缓存再同步。
 * 以前只存在这台浏览器里的旧数据,第一次同步时并进当前账号,然后删掉。
 */
const LEGACY_FAVORITES = "mote.modelFavorites";
const LEGACY_RECENTS = "mote.modelRecents";

/** 账号的缓存键:用 Key + 中转站地址的哈希,不把 Key 明文当键名 */
function cacheKey() {
  // 自定义中转站填了主 Key 时按主 Key 区分账号
  const source = `${customAccountKey() || readApiKey()}|${readRelayBase()}`;
  let hash = 0x811c9dc5;
  for (let index = 0; index < source.length; index++) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `mote.modelPrefs.${hash.toString(16)}`;
}

function readJsonItem(key: string): unknown {
  try { return JSON.parse(window.localStorage.getItem(key) || "null"); } catch { return null; }
}
const readList = (key: string) => {
  const value = readJsonItem(key);
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
};

function legacyPrefs(): ModelPrefs | undefined {
  const favorites = readList(LEGACY_FAVORITES);
  const recents = readList(LEGACY_RECENTS);
  return favorites.length || recents.length ? { favorites, recents } : undefined;
}

function writeCache(prefs: ModelPrefs) {
  try { window.localStorage.setItem(cacheKey(), JSON.stringify(prefs)); } catch { /* 只影响打开时先显示的内容 */ }
}

/** 打开面板时先显示的:这个账号的缓存;还没同步过时用这台浏览器的旧数据 */
export function cachedModelPrefs(): ModelPrefs {
  const cached = readJsonItem(cacheKey());
  if (cached) return parseModelPrefs(cached);
  return legacyPrefs() || emptyModelPrefs();
}

async function post(op: ModelPrefsOp) {
  const response = await fetch("/api/model-prefs", {
    method: "POST", headers: { ...apiKeyHeaders(), "Content-Type": "application/json" }, body: JSON.stringify(op),
  });
  if (!response.ok) throw new Error("常用同步失败");
  return parseModelPrefs(await response.json());
}

/** 从服务端取最新的(顺带把旧的本地数据并进账号);没填 Key 或网络失败时返回 undefined */
export async function syncModelPrefs(): Promise<ModelPrefs | undefined> {
  if (!readApiKey()) return undefined;
  try {
    const legacy = legacyPrefs();
    let prefs: ModelPrefs;
    if (legacy) {
      prefs = await post({ type: "merge", ...legacy });
      try {
        window.localStorage.removeItem(LEGACY_FAVORITES);
        window.localStorage.removeItem(LEGACY_RECENTS);
      } catch { /* 下次再并一次也没关系(合并是去重的) */ }
    } else {
      const response = await fetch("/api/model-prefs", { headers: apiKeyHeaders(), cache: "no-store" });
      if (!response.ok) return undefined;
      prefs = parseModelPrefs(await response.json());
    }
    writeCache(prefs);
    return prefs;
  } catch {
    return undefined;
  }
}

/**
 * 改一次「常用」:先在本地套用(界面立刻变),再发给服务端;onSynced 拿到服务端合并后的完整记录
 * (别的设备刚做的改动也在里面)。没填 Key 时只改本地缓存。
 */
export function changeModelPrefs(current: ModelPrefs, op: ModelPrefsOp, onSynced?: (prefs: ModelPrefs) => void): ModelPrefs {
  const next = applyModelPrefsOp(current, op);
  writeCache(next);
  if (readApiKey()) {
    void post(op).then((prefs) => {
      writeCache(prefs);
      onSynced?.(prefs);
    }).catch(() => undefined);
  }
  return next;
}
