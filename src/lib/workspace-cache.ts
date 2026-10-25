"use client";

import { customAccountKey, readApiKey, readRelayBase } from "./api-key";
import type { ConversationGroup } from "@/components/conversation-list";
import type { PromptLayout } from "./prompt-layout";
import type { PromptTemplate } from "./prompt-library";
import type { Conversation } from "./types";

/**
 * 工作台首屏缓存:上次加载成功的对话、分组、收藏、提示词库按账号存在浏览器里。
 * 打开页面先显示它(不用等服务端),同时照常向服务端取最新的,回来后整体替换。
 * 只是加速显示用:读写失败、格式不对、太大都直接跳过,以服务端为准。
 */
export interface WorkspaceSnapshot {
  conversations: Conversation[];
  favorites: string[];
  prompts: PromptTemplate[];
  groups: ConversationGroup[];
  layout: PromptLayout;
}

const VERSION = 1;
// localStorage 一般 5MB 上限,留出余量给其他设置
const MAX_CHARS = 2_500_000;

/** 按账号区分(Key + 中转站地址的哈希,不把 Key 明文当键名) */
function cacheKey() {
  const account = customAccountKey() || readApiKey();
  if (!account) return "";
  const source = `${account}|${readRelayBase()}`;
  let hash = 0x811c9dc5;
  for (let index = 0; index < source.length; index++) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `mote.workspace.${hash.toString(16)}`;
}

export function readWorkspaceCache(): WorkspaceSnapshot | undefined {
  const key = cacheKey();
  if (!key) return undefined;
  try {
    const value = JSON.parse(window.localStorage.getItem(key) || "null") as { version?: number; data?: WorkspaceSnapshot } | null;
    const data = value?.version === VERSION ? value.data : undefined;
    if (!data || !Array.isArray(data.conversations) || !Array.isArray(data.groups)) return undefined;
    return data;
  } catch { return undefined; }
}

export function writeWorkspaceCache(data: WorkspaceSnapshot) {
  const key = cacheKey();
  if (!key) return;
  try {
    const text = JSON.stringify({ version: VERSION, savedAt: new Date().toISOString(), data });
    if (text.length > MAX_CHARS) { window.localStorage.removeItem(key); return; }
    window.localStorage.setItem(key, text);
  } catch { /* 存不下就算了,下次照常从服务端读 */ }
}
