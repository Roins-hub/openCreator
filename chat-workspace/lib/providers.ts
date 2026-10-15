export const PROVIDERS = {
  tangzhi: {
    id: "tangzhi",
    name: "Tangzhi 中转站",
    baseUrl: "https://new.tangzhi.org",
    shortUrl: "new.tangzhi.org",
  },
} as const;

/** 默认中转站;本地保存的旧中转站(已移除)会回落到这里 */
export const DEFAULT_PROVIDER_ID: ProviderId = "tangzhi";

export type ProviderId = keyof typeof PROVIDERS;

export function isProviderId(value: unknown): value is ProviderId {
  return typeof value === "string" && Object.hasOwn(PROVIDERS, value);
}

export function providerApiBase(provider: ProviderId) {
  return `${PROVIDERS[provider].baseUrl}/v1`;
}

/** 用户自填地址的中转站;地址只存在浏览器里,随请求发给服务端 */
export const CUSTOM_PROVIDER_ID = "custom";

export type ProviderChoice = ProviderId | typeof CUSTOM_PROVIDER_ID;

export function isProviderChoice(value: unknown): value is ProviderChoice {
  return value === CUSTOM_PROVIDER_ID || isProviderId(value);
}

/**
 * 把用户填写的地址规范成 OpenAI 兼容的 API base,无效时返回 null。
 * 可省略协议(默认 https);粘贴完整接口地址时去掉 /chat/completions 等尾巴;
 * 末尾不是 /v1、/v3 这类版本段时自动补 /v1。
 */
export function customApiBase(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const raw = value.trim();
  if (!raw || raw.length > 2048) return null;

  let url: URL;
  try {
    url = new URL(/^[a-z][a-z\d+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  if (url.username || url.password || !url.hostname) return null;

  const path = url.pathname
    .replace(/\/+$/, "")
    .replace(/\/(?:chat\/completions|responses|models)$/i, "");
  const base = `${url.origin}${path}`;
  return /\/v\d+(?:beta\d*)?$/i.test(path) ? base : `${base}/v1`;
}

/** 自定义地址的简短展示形式,如 api.example.com/v1 */
export function customShortUrl(value: string) {
  const apiBase = customApiBase(value);
  return apiBase ? apiBase.replace(/^https:\/\//, "") : "";
}

export function normalizeApiKey(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

export function normalizeModel(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}
