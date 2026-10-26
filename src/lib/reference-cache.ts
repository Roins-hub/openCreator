"use client";

import type { Asset, AssetFolder } from "./asset-store";
import type { MediaKind } from "./tangzhi";
import { accountCacheKey } from "./workspace-cache";

/**
 * @ 选择素材的浏览器缓存(按账号):打开选择框先显示上次的列表,不用等网络;
 * 同时照常向服务端取最新的,回来后替换。只是加速显示,读写失败、太大都跳过。
 */
export type ReferenceAsset = Asset & { kind: MediaKind };
export interface ReferenceSnapshot { assets: ReferenceAsset[]; folders: AssetFolder[] }

const VERSION = 1;
const MAX_CHARS = 1_000_000;
const cacheKey = () => accountCacheKey("mote.references");

export function readReferenceCache(): ReferenceSnapshot | undefined {
  const key = cacheKey();
  if (!key) return undefined;
  try {
    const value = JSON.parse(window.localStorage.getItem(key) || "null") as { version?: number; data?: ReferenceSnapshot } | null;
    const data = value?.version === VERSION ? value.data : undefined;
    return data && Array.isArray(data.assets) && Array.isArray(data.folders) ? data : undefined;
  } catch { return undefined; }
}

export function writeReferenceCache(data: ReferenceSnapshot) {
  const key = cacheKey();
  if (!key) return;
  try {
    const text = JSON.stringify({ version: VERSION, data });
    if (text.length > MAX_CHARS) { window.localStorage.removeItem(key); return; }
    window.localStorage.setItem(key, text);
  } catch { /* 存不下就算了,下次照常从服务端读 */ }
}
