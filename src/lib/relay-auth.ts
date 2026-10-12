import { constants, publicEncrypt } from "node:crypto";
import { relayMessage } from "./relay-messages";
import { TANGZHI_BASE_URL } from "./tangzhi";

/**
 * 以用户身份调用内置中转站(new-api)的账号接口:注册、发验证码、登录、管理令牌、查余额。
 * - 服务端之间优先走 RELAY_INTERNAL_URL(同机部署时直连 new-api 容器),没配置时走公网地址;
 * - 带上用户真实 IP,中转站按 IP 的登录/注册限流才不会把所有人算成同一个人;
 * - 余额用 RELAY_ADMIN_TOKEN(只需 user:read 权限的访问令牌)读取,没配置时不显示余额。
 */

/** 工作台为每个账号自动创建的令牌名 */
export const WORKSPACE_KEY_NAME = "video.1xxai.com 工作台";

export class RelayAuthError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}

const relayBase = () => (process.env.RELAY_INTERNAL_URL || TANGZHI_BASE_URL).replace(/\/+$/, "");

type Headers = Record<string, string>;

/** 中转站登录后的会话(只在一次请求里使用,不保存) */
export interface RelaySession { accountId: string; username: string; headers: Headers }

function ipHeaders(clientIp?: string): Headers {
  return clientIp ? { "X-Forwarded-For": clientIp, "X-Real-IP": clientIp } : {};
}

/** 中转站后台接口统一是 { success, message, data } */
async function call<T = unknown>(
  path: string,
  { method = "GET", body, headers = {}, clientIp }: { method?: string; body?: unknown; headers?: Headers; clientIp?: string } = {},
): Promise<{ data: T; response: Response }> {
  let response: Response;
  try {
    response = await fetch(`${relayBase()}${path}`, {
      method,
      cache: "no-store",
      signal: AbortSignal.timeout(20_000),
      headers: {
        Accept: "application/json",
        // 旧版中转站按这个头返回中文提示;rc.43 起只返回英文和 message_key,由 relayMessage 翻译
        "Accept-Language": "zh-CN",
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        ...ipHeaders(clientIp),
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new RelayAuthError("暂时无法连接中转站，请稍后重试", 502);
  }
  const json = await response.json().catch(() => null) as
    { success?: boolean; message?: string; message_key?: string; message_params?: Record<string, unknown>; data?: T } | null;
  if (response.status === 429) throw new RelayAuthError("操作太频繁，请稍后再试", 429);
  if (!response.ok || !json || json.success === false) {
    throw new RelayAuthError(relayMessage(json) || `中转站返回 ${response.status}`, response.status >= 500 ? 502 : 400);
  }
  return { data: json.data as T, response };
}

const turnstileQuery = (turnstile?: string) => (turnstile ? `?turnstile=${encodeURIComponent(turnstile)}` : "");

// ---- 中转站公开配置

export interface RelayStatus {
  systemName: string;
  registerEnabled: boolean;
  passwordRegisterEnabled: boolean;
  emailVerification: boolean;
  /** 中转站开启人机验证时的站点 Key,未开启为空 */
  turnstileSiteKey: string;
  quotaPerUnit: number;
  quotaDisplayType: string;
  usdExchangeRate: number;
}

let statusCache: { at: number; value: RelayStatus } | undefined;

export async function relayStatus(): Promise<RelayStatus> {
  if (statusCache && Date.now() - statusCache.at < 60_000) return statusCache.value;
  const { data } = await call<Record<string, unknown>>("/api/status");
  const value: RelayStatus = {
    systemName: String(data.system_name || ""),
    registerEnabled: data.register_enabled !== false,
    passwordRegisterEnabled: data.password_register_enabled !== false,
    emailVerification: Boolean(data.email_verification),
    turnstileSiteKey: data.turnstile_check ? String(data.turnstile_site_key || "") : "",
    quotaPerUnit: Number(data.quota_per_unit) || 500000,
    quotaDisplayType: String(data.quota_display_type || (data.display_in_currency === false ? "TOKENS" : "USD")),
    usdExchangeRate: Number(data.usd_exchange_rate) || 7.3,
  };
  statusCache = { at: Date.now(), value };
  return value;
}

/** 把额度换成中转站设置的显示方式 */
export function formatQuota(quota: number, status: RelayStatus) {
  const usd = quota / status.quotaPerUnit;
  if (status.quotaDisplayType === "CNY") return `¥${(usd * status.usdExchangeRate).toFixed(2)}`;
  if (status.quotaDisplayType === "TOKENS") return quota.toLocaleString("zh-CN");
  return `$${usd.toFixed(2)}`;
}

// ---- 注册

export async function sendEmailCode(email: string, turnstile?: string, clientIp?: string) {
  const query = `?email=${encodeURIComponent(email)}${turnstile ? `&turnstile=${encodeURIComponent(turnstile)}` : ""}`;
  await call(`/api/verification${query}`, { clientIp });
}

export interface RegisterInput {
  username: string;
  password: string;
  email?: string;
  code?: string;
  affCode?: string;
}

export async function registerAccount(input: RegisterInput, turnstile?: string, clientIp?: string) {
  await call(`/api/user/register${turnstileQuery(turnstile)}`, {
    method: "POST",
    clientIp,
    body: {
      username: input.username,
      password: input.password,
      email: input.email || "",
      verification_code: input.code || "",
      aff_code: input.affCode || "",
    },
  });
}

// ---- 登录

/** 中转站开启「登录密码加密」时,先用它的公钥加密密码 */
async function passwordFields(password: string): Promise<Record<string, string>> {
  const info = await call<{ enabled?: boolean; kid?: string; public_key?: string }>("/api/user/login/encryption-key")
    .then(({ data }) => data)
    .catch(() => null); // 旧版中转站没有这个接口
  if (!info?.enabled || !info.public_key || !info.kid) return { password };
  const encrypted = publicEncrypt(
    { key: info.public_key, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: "sha256" },
    Buffer.from(password, "utf8"),
  ).toString("base64");
  return { password_encrypted: encrypted, encryption_key_id: info.kid };
}

export async function loginAccount(username: string, password: string, turnstile?: string, clientIp?: string): Promise<RelaySession> {
  const { data, response } = await call<{
    require_2fa?: boolean; access_token?: string; id?: number; username?: string;
    user?: { id?: number; username?: string };
  }>(`/api/user/login${turnstileQuery(turnstile)}`, {
    method: "POST",
    clientIp,
    body: { username, ...(await passwordFields(password)) },
  });
  if (data?.require_2fa) throw new RelayAuthError("该账号开启了两步验证，请先在中转站关闭后再登录");
  const id = data?.user?.id ?? data?.id;
  if (!id) throw new RelayAuthError("中转站登录响应缺少账号信息", 502);
  // rc.22 起登录返回 Bearer 令牌,更早的版本用 Cookie 会话,两种都带上
  const headers: Headers = { "New-Api-User": String(id) };
  if (data.access_token) headers.Authorization = `Bearer ${data.access_token}`;
  const cookies = response.headers.getSetCookie?.() ?? [];
  if (cookies.length) headers.Cookie = cookies.map((item) => item.split(";")[0]).join("; ");
  return { accountId: String(id), username: data.user?.username || data.username || username, headers };
}

export async function logoutAccount(session: RelaySession) {
  await call("/api/user/auth/logout", { method: "POST", headers: session.headers }).catch(() => undefined);
}

// ---- 令牌

interface RelayToken { id: number; name: string; status: number; expired_time: number }

async function listTokens(session: RelaySession) {
  const tokens: RelayToken[] = [];
  for (let page = 1; page <= 20; page++) {
    const { data } = await call<{ items?: RelayToken[]; total?: number } | RelayToken[]>(
      `/api/token/?p=${page}&page_size=100`, { headers: session.headers });
    const items = Array.isArray(data) ? data : data?.items || [];
    tokens.push(...items);
    const total = Array.isArray(data) ? items.length : Number(data?.total) || 0;
    if (items.length < 100 || tokens.length >= total) break;
  }
  return tokens;
}

async function revealKeys(session: RelaySession, ids: number[]) {
  const keys = new Map<number, string>();
  for (let start = 0; start < ids.length; start += 100) {
    const { data } = await call<{ keys?: Record<string, string> }>("/api/token/batch/keys", {
      method: "POST", headers: session.headers, body: { ids: ids.slice(start, start + 100) },
    });
    for (const [id, key] of Object.entries(data?.keys || {})) keys.set(Number(id), key);
  }
  return keys;
}

const usable = (token: RelayToken) =>
  token.status === 1 && (token.expired_time === -1 || token.expired_time > Date.now() / 1000);

/**
 * 找到(没有就创建)工作台专用令牌,返回它的明文;同时返回账号名下全部令牌的明文,
 * 用来把以前「粘贴 Key」时按 Key 存的旧记录合并到账号下。
 */
export async function ensureWorkspaceKey(session: RelaySession) {
  let tokens = await listTokens(session);
  if (!tokens.some((token) => token.name === WORKSPACE_KEY_NAME && usable(token))) {
    await call("/api/token/", {
      method: "POST",
      headers: session.headers,
      body: { name: WORKSPACE_KEY_NAME, remain_quota: 0, unlimited_quota: true, expired_time: -1, model_limits_enabled: false, model_limits: "" },
    });
    tokens = await listTokens(session);
  }
  const workspace = tokens.filter((token) => token.name === WORKSPACE_KEY_NAME && usable(token)).sort((a, b) => b.id - a.id)[0];
  if (!workspace) throw new RelayAuthError("无法为账号创建令牌，请稍后重试", 502);
  const keys = await revealKeys(session, tokens.map((token) => token.id));
  const key = keys.get(workspace.id);
  if (!key) throw new RelayAuthError("无法读取账号令牌，请稍后重试", 502);
  return { tokenId: workspace.id, key: key.startsWith("sk-") ? key : `sk-${key}`, allKeys: [...keys.values()] };
}

// ---- 余额

/** 用只读管理员令牌读账号余额;没配置令牌或读取失败时返回 null */
export async function accountQuota(accountId: string): Promise<number | null> {
  const token = process.env.RELAY_ADMIN_TOKEN?.trim();
  if (!token) return null;
  try {
    const { data } = await call<{ quota?: number }>(`/api/user/${encodeURIComponent(accountId)}`, {
      headers: { Authorization: `Bearer ${token}`, ...(process.env.RELAY_ADMIN_USER_ID ? { "New-Api-User": process.env.RELAY_ADMIN_USER_ID } : {}) },
    });
    return Number(data?.quota) || 0;
  } catch (error) {
    console.warn("[mote] 读取账号余额失败:", (error as Error).message);
    return null;
  }
}
