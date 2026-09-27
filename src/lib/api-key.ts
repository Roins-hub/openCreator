"use client";

/** 每位用户的中转站 API Key 只保存在自己的浏览器里,请求时通过请求头交给本站服务端转发。 */
const STORAGE_KEY = "mote.tangzhi.apiKey";
export const API_KEY_HEADER = "x-tangzhi-key";
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

export function onApiKeyChange(listener: () => void) {
  const storage = (event: StorageEvent) => { if (event.key === STORAGE_KEY) listener(); };
  window.addEventListener(CHANGE_EVENT, listener);
  window.addEventListener("storage", storage);
  return () => {
    window.removeEventListener(CHANGE_EVENT, listener);
    window.removeEventListener("storage", storage);
  };
}

export function apiKeyHeaders(key = readApiKey()): Record<string, string> {
  return key ? { [API_KEY_HEADER]: key } : {};
}
