"use client";

/** 每位用户的中转站 API Key 只保存在自己的浏览器里,请求时通过请求头交给本站服务端转发。 */
const STORAGE_KEY = "mote.tangzhi.apiKey";
/** 自定义中转站地址;没设置时用内置的 new.tangzhi.org */
const BASE_STORAGE_KEY = "mote.tangzhi.baseUrl";
export const API_KEY_HEADER = "x-tangzhi-key";
export const RELAY_HEADER = "x-tangzhi-base";
/** 图片单独用的 Key(选填);服务端没收到时图片也用视频的 Key */
export const IMAGE_KEY_HEADER = "x-tangzhi-image-key";
const CHANGE_EVENT = "mote-api-key-change";

export function readApiKey() {
  try { return window.localStorage.getItem(STORAGE_KEY)?.trim() || ""; } catch { return ""; }
}

export function writeApiKey(value: string) {
  try {
    if (value.trim()) window.localStorage.setItem(STORAGE_KEY, value.trim());
    else window.localStorage.removeItem(STORAGE_KEY);
  } catch { /* 隐私模式等无法写入时忽略 */ }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

export function readRelayBase() {
  try { return window.localStorage.getItem(BASE_STORAGE_KEY)?.trim() || ""; } catch { return ""; }
}

/** 传空字符串恢复默认中转站。换地址等于换了一个空间,和换 Key 一样通知页面重新加载。 */
export function writeRelayBase(value: string) {
  try {
    if (value.trim()) window.localStorage.setItem(BASE_STORAGE_KEY, value.trim().replace(/\/+$/, ""));
    else window.localStorage.removeItem(BASE_STORAGE_KEY);
  } catch { /* 隐私模式等无法写入时忽略 */ }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

export function onApiKeyChange(listener: () => void) {
  const storage = (event: StorageEvent) => { if (event.key === STORAGE_KEY || event.key === BASE_STORAGE_KEY) listener(); };
  window.addEventListener(CHANGE_EVENT, listener);
  window.addEventListener("storage", storage);
  return () => {
    window.removeEventListener(CHANGE_EVENT, listener);
    window.removeEventListener("storage", storage);
  };
}

/** 请求头:视频的 Key(也决定对话和资产存在哪个账号)、中转站地址,单独填了图片 Key 时一并带上 */
export function apiKeyHeaders(key = readApiKey(), base = readRelayBase(), imageKey = readImageKey()): Record<string, string> {
  return {
    ...(key ? { [API_KEY_HEADER]: key } : {}),
    ...(base ? { [RELAY_HEADER]: base } : {}),
    ...(imageKey && imageKey !== key ? { [IMAGE_KEY_HEADER]: imageKey } : {}),
  };
}

/** 用当前 Key 换取看视频/图片用的 Cookie;Key 无效时抛出中转站的提示。 */
export async function openSession(key = readApiKey(), base = readRelayBase()) {
  if (!key) {
    await fetch("/api/session", { method: "DELETE" }).catch(() => undefined);
    return;
  }
  const response = await fetch("/api/session", { method: "POST", headers: apiKeyHeaders(key, base) });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || "API Key 验证失败");
  }
}

/**
 * 按用途分开的 Key(选填):图片可以和视频用不同的 Key(不同分组 / 账号);
 * 聊天和提示词优化要调用文本模型,视频的 Key 所在分组未必有,所以也可以各填一个。
 * 图片、聊天没填用视频的 Key;提示词优化没填先用聊天的 Key,聊天也没填再用视频的 Key。
 * 聊天记录、资产始终按视频的 Key 对应的账号存放。
 */
const IMAGE_KEY_STORAGE = "mote.tangzhi.imageKey";
const CHAT_KEY_STORAGE = "mote.tangzhi.chatKey";
const ASSIST_KEY_STORAGE = "mote.tangzhi.assistKey";

function readStored(name: string) {
  try { return window.localStorage.getItem(name)?.trim() || ""; } catch { return ""; }
}

function writeStored(name: string, value: string) {
  try {
    if (value.trim()) window.localStorage.setItem(name, value.trim());
    else window.localStorage.removeItem(name);
  } catch { /* 隐私模式等无法写入时忽略 */ }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

export const readImageKey = () => readStored(IMAGE_KEY_STORAGE);
export const writeImageKey = (value: string) => writeStored(IMAGE_KEY_STORAGE, value);
export const readChatKey = () => readStored(CHAT_KEY_STORAGE);
export const writeChatKey = (value: string) => writeStored(CHAT_KEY_STORAGE, value);
export const readAssistKey = () => readStored(ASSIST_KEY_STORAGE);
export const writeAssistKey = (value: string) => writeStored(ASSIST_KEY_STORAGE, value);

/** 提示词优化实际用的 Key:单独填了就用它,否则用聊天的 Key,聊天也没填再用视频的 Key */
export const effectiveAssistKey = () => readAssistKey() || readChatKey() || readApiKey();
export const assistKeyHeaders = () => apiKeyHeaders(effectiveAssistKey());

// 提示词优化用的对话模型:空 = 自动(只存在当前浏览器)
const ASSIST_MODEL_KEY = "mote.assistModel";

export function readAssistModel() {
  try { return window.localStorage.getItem(ASSIST_MODEL_KEY)?.trim() || ""; } catch { return ""; }
}

export function writeAssistModel(model: string) {
  try {
    if (model) window.localStorage.setItem(ASSIST_MODEL_KEY, model);
    else window.localStorage.removeItem(ASSIST_MODEL_KEY);
  } catch { /* 隐私模式等无法写入时忽略 */ }
}
