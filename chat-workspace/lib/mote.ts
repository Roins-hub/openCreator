/**
 * 「工作台模式」:聊天挂在 Mote 视频 / 图片工作台的同一域名下(vip.tangzhi.org/chat)。
 * - API Key、自定义中转站地址、主题都沿用工作台在本域名下保存的设置,不用再填一次;
 * - 聊天记录存到工作台服务器(按中转站账号隔离),换设备也在;
 * - 「生图」直接跳回工作台,用工作台的生图模型出图。
 * 构建期由 NEXT_PUBLIC_CHAT_MODE=mote、NEXT_PUBLIC_BASE_PATH=/chat 打开。
 */
export const MOTE_MODE = process.env.NEXT_PUBLIC_CHAT_MODE === "mote";

/** Next.js basePath:页面路由会自动加,手写的 fetch 地址要自己加 */
export const BASE_PATH = (process.env.NEXT_PUBLIC_BASE_PATH || "").replace(/\/+$/, "");
export const withBasePath = (path: string) => `${BASE_PATH}${path}`;

/** 旧站(独立域名)上提示用户搬家的新地址;为空则不提示 */
export const MIGRATE_URL = process.env.NEXT_PUBLIC_MIGRATE_URL?.trim() || "";

const MOTE_KEY = "mote.tangzhi.apiKey";
/** 工作台设置里的「图片」Key(选填);没填视频 Key 时它就是账号 Key */
const MOTE_IMAGE_KEY = "mote.tangzhi.imageKey";
/** 自定义中转站的主 Key(选填):对话和资产按它存放,其余 Key 没填时也用它 */
const MOTE_ACCOUNT_KEY = "mote.tangzhi.accountKey";
/** 工作台设置里单独给「聊天」填的 Key(选填);没填时用账号 Key */
const MOTE_CHAT_KEY = "mote.tangzhi.chatKey";
/** 「聊天」那一栏额外加的 Key(JSON 数组) */
const MOTE_CHAT_EXTRA_KEYS = "mote.tangzhi.chatKeysExtra";
const MOTE_BASE = "mote.tangzhi.baseUrl";
export const MOTE_THEME_KEY = "mote-theme";
/** 工作台改了 Key 时在同一标签页内广播的事件 */
const MOTE_KEY_EVENT = "mote-api-key-change";

const read = (name: string) => {
  try {
    return window.localStorage.getItem(name)?.trim() || "";
  } catch {
    return "";
  }
};

/** 自定义中转站的主 Key;默认中转站不用 */
const moteAccountKey = () => (read(MOTE_BASE) ? read(MOTE_ACCOUNT_KEY) : "");
/** 调用中转站的 Key:视频 Key,没填时用主 Key(自定义中转站),再没有用图片 Key(和工作台一致) */
export const moteApiKey = () => read(MOTE_KEY) || moteAccountKey() || read(MOTE_IMAGE_KEY);
/** 聊天调用模型用的 Key:工作台设置里的「聊天」Key,没填就用账号 Key。
 * 聊天记录仍按账号 Key 对应的账号存放(见 moteHeaders),换聊天 Key 不会让记录分开。 */
export const moteChatKey = () => read(MOTE_CHAT_KEY) || moteApiKey();
/**
 * 聊天用的全部 Key:工作台设置里「聊天」那一栏可以再加几个(只在自定义中转站),
 * 模型列表取这些 Key 的合集,发消息时用能调用所选模型的那个 Key。
 */
export function moteChatKeys(): string[] {
  const keys = [moteChatKey()];
  if (read(MOTE_BASE)) {
    try {
      const extra = JSON.parse(read(MOTE_CHAT_EXTRA_KEYS) || "[]");
      if (Array.isArray(extra)) keys.push(...extra.filter((item): item is string => typeof item === "string"));
    } catch { /* 格式不对就只用主要的 Key */ }
  }
  return [...new Set(keys.map((key) => key.trim()).filter(Boolean))];
}

/** 工作台里的自定义中转站地址;空 = 默认中转站 */
export const moteRelayBase = () => read(MOTE_BASE);

/** 请求工作台接口时带上的身份头(和工作台自己的请求一致) */
export function moteHeaders(): Record<string, string> {
  const key = moteApiKey();
  const base = moteRelayBase();
  const account = moteAccountKey();
  return {
    ...(key ? { "x-tangzhi-key": key } : {}),
    ...(base ? { "x-tangzhi-base": base } : {}),
    // 自定义中转站填了主 Key:聊天记录按主 Key 存放(和工作台同一个空间)
    ...(base && account ? { "x-tangzhi-account-key": account } : {}),
  };
}

/** 工作台的 Key / 地址变化(其他标签页改了设置)时回调 */
export function onMoteSettingsChange(callback: () => void) {
  const onStorage = (event: StorageEvent) => {
    if (event.key === MOTE_KEY || event.key === MOTE_IMAGE_KEY || event.key === MOTE_ACCOUNT_KEY
      || event.key === MOTE_CHAT_KEY || event.key === MOTE_CHAT_EXTRA_KEYS || event.key === MOTE_BASE) callback();
  };
  window.addEventListener("storage", onStorage);
  window.addEventListener(MOTE_KEY_EVENT, callback);
  return () => {
    window.removeEventListener("storage", onStorage);
    window.removeEventListener(MOTE_KEY_EVENT, callback);
  };
}

/** 工作台首页;带上提示词时打开生图模型并填好输入框(不会自动生成) */
export const MOTE_HOME = "/";
export const MOTE_SETTINGS = "/settings";
/** 聊天附件管理页(在工作台那边,和资产页同一套) */
export const MOTE_ATTACHMENTS = "/attachments";
export const moteComposeUrl = (prompt: string, kind: "image" | "video" = "image") =>
  `/?compose=${encodeURIComponent(prompt)}&kind=${kind}`;

/** 与工作台 lib/themes.ts 保持一致 */
const MOTE_THEMES = ["paper", "celadon", "mist", "sakura", "mono", "amber", "graphite", "midnight", "forest", "neon"];
const DARK_THEMES = new Set(["graphite", "midnight", "forest", "neon"]);

/** 首帧前执行:读取工作台主题,设置 data-mote-theme 和 .dark */
export const moteThemeScript = `(function(){try{var ids=${JSON.stringify(MOTE_THEMES)};var dark=${JSON.stringify([...DARK_THEMES])};var m=localStorage.getItem("${MOTE_THEME_KEY}");if(m!=="system"&&ids.indexOf(m)<0)m="system";var t=m==="system"?(matchMedia("(prefers-color-scheme: dark)").matches?"graphite":"paper"):m;var r=document.documentElement;r.dataset.moteTheme=t;r.classList.toggle("dark",dark.indexOf(t)>=0);}catch(e){}})();`;

export function applyMoteTheme() {
  try {
    let mode = window.localStorage.getItem(MOTE_THEME_KEY) || "system";
    if (mode !== "system" && !MOTE_THEMES.includes(mode)) mode = "system";
    const theme = mode === "system"
      ? window.matchMedia("(prefers-color-scheme: dark)").matches ? "graphite" : "paper"
      : mode;
    const root = document.documentElement;
    root.dataset.moteTheme = theme;
    root.classList.toggle("dark", DARK_THEMES.has(theme));
  } catch {
    /* 隐私模式等读不到设置时沿用默认 */
  }
}
