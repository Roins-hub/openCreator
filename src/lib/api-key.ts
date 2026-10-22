"use client";

/** 每位用户的中转站 API Key 只保存在自己的浏览器里,请求时通过请求头交给本站服务端转发。 */
const STORAGE_KEY = "mote.tangzhi.apiKey";
/** 自定义中转站地址;没设置时用内置的 new.tangzhi.org */
const BASE_STORAGE_KEY = "mote.tangzhi.baseUrl";
export const API_KEY_HEADER = "x-tangzhi-key";
export const RELAY_HEADER = "x-tangzhi-base";
/** 图片单独用的 Key(选填);服务端没收到时图片也用视频的 Key */
export const IMAGE_KEY_HEADER = "x-tangzhi-image-key";
/** 自定义中转站的主 Key:对话和资产按它存放(见服务端 identity.ts) */
export const ACCOUNT_KEY_HEADER = "x-tangzhi-account-key";
/** 只填了图片 Key(没有视频 Key):服务端只列生图模型、不接视频生成 */
export const IMAGE_ONLY_HEADER = "x-tangzhi-image-only";
const CHANGE_EVENT = "mote-api-key-change";

/** 设置里填的视频 Key(可能没填) */
export function readVideoKey() {
  try { return window.localStorage.getItem(STORAGE_KEY)?.trim() || ""; } catch { return ""; }
}

/**
 * 账号 Key:视频 Key,没填视频 Key 时用图片 Key。决定对话、资产存在哪个账号(默认中转站按 Key 所属账号,
 * 自定义中转站按地址 + Key),也是没单独填 Key 的用途的兜底。
 */
export function readApiKey() {
  return readVideoKey() || customAccountKey() || readImageKey();
}

/** 只填了图片 Key(自定义中转站也没有主 Key) */
export const isImageOnly = () => !readVideoKey() && !customAccountKey() && Boolean(readImageKey());

/**
 * 自定义中转站的主 Key(选填):填了就按它存放对话和资产,视频 / 图片 / 聊天没单独填 Key 时也用它。
 * 默认中转站按 Key 所属账号存放,不用主 Key。
 */
const ACCOUNT_KEY_STORAGE = "mote.tangzhi.accountKey";
export function readAccountKey() {
  try { return window.localStorage.getItem(ACCOUNT_KEY_STORAGE)?.trim() || ""; } catch { return ""; }
}
export function writeAccountKey(value: string) {
  try {
    if (value.trim()) window.localStorage.setItem(ACCOUNT_KEY_STORAGE, value.trim());
    else window.localStorage.removeItem(ACCOUNT_KEY_STORAGE);
  } catch { /* 隐私模式等无法写入时忽略 */ }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}
/** 当前生效的主 Key:只有用自定义中转站时才有 */
export const customAccountKey = () => (readRelayBase() ? readAccountKey() : "");

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
  const storage = (event: StorageEvent) => {
    if (event.key === STORAGE_KEY || event.key === BASE_STORAGE_KEY || event.key === IMAGE_KEY_STORAGE
      || event.key === ACCOUNT_KEY_STORAGE) listener();
  };
  window.addEventListener(CHANGE_EVENT, listener);
  window.addEventListener("storage", storage);
  return () => {
    window.removeEventListener(CHANGE_EVENT, listener);
    window.removeEventListener("storage", storage);
  };
}

/**
 * 请求头:账号 Key(视频 Key,没填时是图片 Key)、中转站地址;单独填了图片 Key 时一并带上,
 * 只有图片 Key 时标记出来(服务端不列视频模型、不接视频生成)。
 */
export function apiKeyHeaders(
  key = readApiKey(), base = readRelayBase(), imageKey = readImageKey(), imageOnly = isImageOnly(),
  accountKey = customAccountKey(),
): Record<string, string> {
  return {
    ...(key ? { [API_KEY_HEADER]: key } : {}),
    ...(base && accountKey ? { [ACCOUNT_KEY_HEADER]: accountKey } : {}),
    ...(base ? { [RELAY_HEADER]: base } : {}),
    ...(imageKey && imageKey !== key ? { [IMAGE_KEY_HEADER]: imageKey } : {}),
    ...(imageOnly ? { [IMAGE_ONLY_HEADER]: "1" } : {}),
  };
}

/** 用当前 Key 换取看视频/图片用的 Cookie;Key 无效时抛出中转站的提示。 */
/** accountKey:自定义中转站的主 Key(有就按它切到对应的空间) */
export async function openSession(key = readApiKey(), base = readRelayBase(), accountKey = customAccountKey()) {
  if (!key) {
    await fetch("/api/session", { method: "DELETE" }).catch(() => undefined);
    return;
  }
  const response = await fetch("/api/session", { method: "POST", headers: apiKeyHeaders(key, base, readImageKey(), false, accountKey) });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || "API Key 验证失败");
  }
}

/**
 * 按用途分开的 Key(选填):图片可以和视频用不同的 Key(不同分组 / 账号);
 * 聊天和提示词优化要调用文本模型,视频的 Key 所在分组未必有,所以也可以各填一个。
 * 图片、聊天没填用视频的 Key;提示词优化没填先用聊天的 Key,聊天也没填再用账号 Key。
 * 视频和图片至少填一个;只填图片 Key 时它就是账号 Key(只能生图)。聊天记录、资产都按账号 Key 存放。
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
