import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { access, mkdir, writeFile } from "node:fs/promises";
import { dataDir, inside } from "./paths";
import { sessionSecret } from "./session-secret";
import { DEFAULT_RELAY, relayFetch, relayOf, type Relay } from "./relay";
import { relayAccounts, type RelayAccounts } from "./relay-accounts";
import { mergeWorkspace, readProfile, writeProfile } from "./workspace-merge";

/**
 * 用户身份:
 * - 站内登录(内置中转站)时按「中转站账号」隔离,令牌由服务端保存,浏览器不需要 Key;
 * - 配置了 RELAY_DB_URL 时,粘贴 Key 的用户也按「中转站账号」隔离:同一账号下的所有 Key(包括新建的)看到同一份记录,
 *   Key 删除后换个新 Key 也能找回;以前按 Key 存的旧数据在账号首次使用时自动合并进来;
 * - 没配置时退回按 Key 隔离(身份 = Key 的哈希);
 * - 用户填了自定义中转站地址时,按「地址 + Key」隔离(我们读不到别人中转站的账号),和内置中转站的数据互不相通。
 * 服务器只保存哈希,不保存 Key。
 */
export const API_KEY_HEADER = "x-tangzhi-key";
export const SESSION_COOKIE = "mote_uid";
/** 站内登录的会话 Cookie */
export const AUTH_COOKIE = "mote_auth";
const AUTH_MAX_AGE = 30 * 24 * 3600;

export interface User { apiKey: string; userId: string; relay: Relay }

const hash = (value: string) => createHash("sha256").update(value).digest("hex").slice(0, 32);

/** 按 Key 隔离时的身份(也是旧数据目录名) */
export function userIdOf(apiKey: string) {
  return hash(`mote:${apiKey.trim()}`);
}

/** 自定义中转站的身份 */
export const customRelayUserId = (base: string, apiKey: string) => hash(`mote-relay:${base}:${apiKey.trim()}`);

/** 按中转站账号隔离时的身份 */
export const accountUserId = (accountId: string) => hash(`mote-account:${accountId}`);

export const userDir = (userId: string) => inside(dataDir, "users", userId);
export const mediaPrefix = (userId: string) => `users/${userId}/`;

const verified = new Set<string>();

/** 按 Key 隔离:首次出现的 Key 先到中转站验证,确认有效才建立空间,避免随便填的 Key 占用存储。 */
async function ensureKeyUser(apiKey: string, userId: string, relay: Relay = DEFAULT_RELAY) {
  if (verified.has(userId)) return;
  const profile = inside(userDir(userId), "profile.json");
  const known = await access(profile).then(() => true, () => false);
  if (!known) {
    const response = await relayFetch(relay, "/v1/models", {
      headers: { Authorization: `Bearer ${apiKey}` }, signal: AbortSignal.timeout(15_000),
    }).catch((error) => {
      throw new Error(relay.custom ? (error as Error).message : "暂时无法连接中转站验证 API Key，请稍后重试");
    });
    if (response.status === 401 || response.status === 403) throw new Error("API Key 无效或已过期，请在设置中检查");
    if (!response.ok) throw new Error(`验证 API Key 失败（中转站返回 ${response.status}）`);
    await mkdir(userDir(userId), { recursive: true });
    await writeFile(profile, `${JSON.stringify({ createdAt: new Date().toISOString() })}\n`, { flag: "wx" })
      .catch((error) => { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; });
  }
  verified.add(userId);
}

// Key -> 账号的结果短暂缓存:Key 在中转站被删除/禁用后,最多一分钟内失效
const KEY_CACHE_MS = 60_000;
const resolvedKeys = new Map<string, { userId: string; expires: number }>();
const preparedAccounts = new Map<string, Promise<void>>();

/** 账号首次使用(每个进程一次):建立空间,把它名下所有 Key(含已删除的)以前的空间合并进来。 */
function prepareAccount(lookup: RelayAccounts, accountId: string, userId: string) {
  let pending = preparedAccounts.get(userId);
  if (!pending) {
    pending = lookup.keysOfAccount(accountId).then((keys) => mergeAccountWorkspaces(accountId, userId, keys));
    preparedAccounts.set(userId, pending);
    // 失败时下次请求重试
    pending.catch(() => preparedAccounts.delete(userId));
  }
  return pending;
}

/** 把账号名下这些 Key 以前按 Key 隔离的空间合并进账号空间,并记下账号 ID。 */
export async function mergeAccountWorkspaces(accountId: string, userId: string, keys: string[]) {
  const legacyIds = new Set(keys.flatMap((key) => [userIdOf(`sk-${key}`), userIdOf(key)]));
  for (const legacyId of legacyIds) {
    if (await mergeWorkspace(legacyId, userId)) {
      console.info(`[mote] 已把旧空间 ${legacyId.slice(0, 8)} 合并到账号 ${accountId}`);
    }
  }
  const profile = await readProfile(userId);
  if (!profile || profile.accountId !== accountId) {
    await mkdir(userDir(userId), { recursive: true });
    await writeProfile(userId, { ...(profile || { createdAt: new Date().toISOString() }), accountId });
  }
  mediaPrefixCache.delete(userId);
}

async function resolveUserId(apiKey: string, relay: Relay) {
  if (relay.custom) {
    const userId = customRelayUserId(relay.base, apiKey);
    await ensureKeyUser(apiKey, userId, relay);
    return userId;
  }
  const lookup = relayAccounts();
  if (!lookup) {
    const userId = userIdOf(apiKey);
    await ensureKeyUser(apiKey, userId);
    return userId;
  }
  const cacheKey = userIdOf(apiKey);
  const hit = resolvedKeys.get(cacheKey);
  if (hit && hit.expires > Date.now()) return hit.userId;
  const accountId = await lookup.accountOfKey(apiKey).catch((error) => {
    console.warn("[mote] 查询中转站账号失败:", (error as Error).message);
    throw new Error("暂时无法验证 API Key，请稍后重试");
  });
  if (!accountId) {
    resolvedKeys.delete(cacheKey);
    throw new Error("API Key 无效、已删除或已过期，请在设置中检查");
  }
  const userId = accountUserId(accountId);
  await prepareAccount(lookup, accountId, userId);
  resolvedKeys.set(cacheKey, { userId, expires: Date.now() + KEY_CACHE_MS });
  return userId;
}

export async function requireUser(request: Request): Promise<User> {
  const relay = relayOf(request);
  if (!relay.custom) {
    // 内置中转站只认站内登录的账号。浏览器里残留的旧 Key 不能代替登录,
    // 只有配置了 RELAY_DB_URL(能把 Key 对应到中转站账号)时才接受 Key
    const account = await accountUser(request);
    if (account) return account;
    if (!relayAccounts()) throw new Error("请先登录");
  }
  const apiKey = request.headers.get(API_KEY_HEADER)?.trim();
  if (!apiKey) throw new Error(relay.custom ? "请先在设置中填写中转站 API Key" : "请先登录");
  return { apiKey, relay, userId: await resolveUserId(apiKey, relay) };
}

// ---- 站内登录:签名 Cookie 记录账号空间 ID 和过期时间,令牌从服务端读取

const authSignature = async (userId: string, expires: number) =>
  createHmac("sha256", await sessionSecret()).update(`auth:${userId}:${expires}`).digest("hex");

const isSecure = (request: Request) =>
  (request.headers.get("x-forwarded-proto") || new URL(request.url).protocol).startsWith("https");

export async function authCookie(userId: string, request: Request) {
  const expires = Math.floor(Date.now() / 1000) + AUTH_MAX_AGE;
  const value = `${userId}.${expires}.${await authSignature(userId, expires)}`;
  return `${AUTH_COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${AUTH_MAX_AGE}${isSecure(request) ? "; Secure" : ""}`;
}

export const clearAuthCookie = () => `${AUTH_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;

const readCookie = (request: Request, name: string) =>
  request.headers.get("cookie")?.split(/;\s*/).find((item) => item.startsWith(`${name}=`))?.slice(name.length + 1);

/** 站内登录的账号空间 ID;没登录或签名、有效期不对时返回 undefined */
export async function authUserId(request: Request) {
  const [userId, expiresText, sig] = readCookie(request, AUTH_COOKIE)?.split(".") || [];
  const expires = Number(expiresText);
  if (!userId || !sig || !/^[0-9a-f]{32}$/.test(userId) || !(expires > Date.now() / 1000)) return undefined;
  const expected = Buffer.from(await authSignature(userId, expires));
  const actual = Buffer.from(sig);
  return expected.length === actual.length && timingSafeEqual(expected, actual) ? userId : undefined;
}

async function accountUser(request: Request): Promise<User | undefined> {
  const userId = await authUserId(request);
  if (!userId) return undefined;
  const { readAccount, decryptSecret } = await import("./account-store");
  const account = await readAccount(userId);
  if (!account) return undefined;
  return { apiKey: await decryptSecret(account.keyEnc), relay: DEFAULT_RELAY, userId };
}

/** 这个用户能访问的媒体前缀:自己的,加上合并进来的旧空间的 */
const mediaPrefixCache = new Map<string, string[]>();
export async function mediaPrefixes(userId: string) {
  let prefixes = mediaPrefixCache.get(userId);
  if (!prefixes) {
    const profile = await readProfile(userId).catch(() => null);
    prefixes = [userId, ...(profile?.mergedFrom || [])].map(mediaPrefix);
    mediaPrefixCache.set(userId, prefixes);
  }
  return prefixes;
}

export async function ownsMedia(userId: string, key: string) {
  return (await mediaPrefixes(userId)).some((prefix) => key.startsWith(prefix));
}

// ---- 浏览器看视频/图片时 <video>/<img> 带不了请求头,用签名 Cookie 识别用户
const signature = async (userId: string) =>
  createHmac("sha256", await sessionSecret()).update(`uid:${userId}`).digest("hex");

export async function sessionCookie(userId: string, request: Request) {
  return `${SESSION_COOKIE}=${userId}.${await signature(userId)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000${isSecure(request) ? "; Secure" : ""}`;
}

export const clearSessionCookie = () => `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;

export async function sessionUserId(request: Request) {
  const raw = request.headers.get("cookie")?.split(/;\s*/).find((item) => item.startsWith(`${SESSION_COOKIE}=`));
  const [userId, sig] = raw?.slice(SESSION_COOKIE.length + 1).split(".") || [];
  if (!userId || !sig || !/^[0-9a-f]{32}$/.test(userId)) return undefined;
  const expected = Buffer.from(await signature(userId));
  const actual = Buffer.from(sig);
  return expected.length === actual.length && timingSafeEqual(expected, actual) ? userId : undefined;
}
