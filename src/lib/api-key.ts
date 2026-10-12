"use client";

/** 每位用户的中转站 API Key 只保存在自己的浏览器里,请求时通过请求头交给本站服务端转发。 */
const STORAGE_KEY = "mote.tangzhi.apiKey";
/** 自定义中转站地址;没设置时用内置的 new.tangzhi.org */
const BASE_STORAGE_KEY = "mote.tangzhi.baseUrl";
export const API_KEY_HEADER = "x-tangzhi-key";
export const RELAY_HEADER = "x-tangzhi-base";
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

export function apiKeyHeaders(key = readApiKey(), base = readRelayBase()): Record<string, string> {
  return { ...(key ? { [API_KEY_HEADER]: key } : {}), ...(base ? { [RELAY_HEADER]: base } : {}) };
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
