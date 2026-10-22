import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { access, mkdir, writeFile } from "node:fs/promises";
import { dataDir, inside } from "./paths";
import { sessionSecret } from "./session-secret";
import { DEFAULT_RELAY, relayFetch, relayOf, type Relay } from "./relay";
import { relayAccounts, type RelayAccounts } from "./relay-accounts";
import { mergeWorkspace, readProfile, writeProfile } from "./workspace-merge";

/**
 * 用户身份:
 * - 配置了 RELAY_DB_URL 时按「中转站账号」隔离:同一账号下的所有 Key(包括新建的)看到同一份记录,
 *   Key 删除后换个新 Key 也能找回;以前按 Key 存的旧数据在账号首次使用时自动合并进来;
 * - 没配置时退回按 Key 隔离(身份 = Key 的哈希);
 * - 用户填了自定义中转站地址时,按「地址 + Key」隔离(我们读不到别人中转站的账号),和内置中转站的数据互不相通。
 * 服务器只保存哈希,不保存 Key。
 */
export const API_KEY_HEADER = "x-tangzhi-key";
/** 图片单独用的 Key(选填);没带时图片也用 API_KEY_HEADER 的 Key */
export const IMAGE_KEY_HEADER = "x-tangzhi-image-key";

/**
 * 自定义中转站的「主 Key」(选填):查不到自定义中转站的账号,数据按「地址 + Key」隔离;
 * 填了主 Key 就固定按它存放对话和资产,换视频 / 图片 Key 不会换空间。默认中转站不看它(按 Key 所属账号)。
 */
export const ACCOUNT_KEY_HEADER = "x-tangzhi-account-key";

/** 只填了图片 Key(没有视频 Key):这时 API_KEY_HEADER 里就是图片 Key,只列生图模型、不接视频生成 */
export const IMAGE_ONLY_HEADER = "x-tangzhi-image-only";
export const isImageOnly = (request: Request) => request.headers.get(IMAGE_ONLY_HEADER) === "1";

/** 生图、列生图模型用的 Key:单独填了就用它,否则用视频的 Key */
export const imageKeyOf = (request: Request, fallback?: string) =>
  request.headers.get(IMAGE_KEY_HEADER)?.trim() || fallback;
export const SESSION_COOKIE = "mote_uid";

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
    pending = (async () => {
      const keys = await lookup.keysOfAccount(accountId);
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
    })();
    preparedAccounts.set(userId, pending);
    // 失败时下次请求重试
    pending.catch(() => preparedAccounts.delete(userId));
  }
  return pending;
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
  const apiKey = request.headers.get(API_KEY_HEADER)?.trim();
  if (!apiKey) throw new Error("请先在设置中填写中转站 API Key");
  const relay = relayOf(request);
  // 自定义中转站填了主 Key:数据按主 Key 存;调用中转站仍用各自的 Key(apiKey)
  const accountKey = relay.custom ? request.headers.get(ACCOUNT_KEY_HEADER)?.trim() : undefined;
  return { apiKey, relay, userId: await resolveUserId(accountKey || apiKey, relay) };
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
  const secure = (request.headers.get("x-forwarded-proto") || new URL(request.url).protocol).startsWith("https");
  return `${SESSION_COOKIE}=${userId}.${await signature(userId)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000${secure ? "; Secure" : ""}`;
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
