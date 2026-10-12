import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { access, mkdir, writeFile } from "node:fs/promises";
import { dataDir, inside } from "./paths";
import { sessionSecret } from "./session-secret";
import { TANGZHI_BASE_URL } from "./tangzhi";
import { relayAccounts, type RelayAccounts } from "./relay-accounts";
import { mergeWorkspace, readProfile, writeProfile } from "./workspace-merge";

/**
 * 用户身份:
 * - 配置了 RELAY_DB_URL 时按「中转站账号」隔离:同一账号下的所有 Key(包括新建的)看到同一份记录,
 *   Key 删除后换个新 Key 也能找回;以前按 Key 存的旧数据在账号首次使用时自动合并进来;
 * - 没配置时退回按 Key 隔离(身份 = Key 的哈希)。
 * 服务器只保存哈希,不保存 Key。
 */
export const API_KEY_HEADER = "x-tangzhi-key";
export const SESSION_COOKIE = "mote_uid";

export interface User { apiKey: string; userId: string }

const hash = (value: string) => createHash("sha256").update(value).digest("hex").slice(0, 32);

/** 按 Key 隔离时的身份(也是旧数据目录名) */
export function userIdOf(apiKey: string) {
  return hash(`mote:${apiKey.trim()}`);
}

/** 按中转站账号隔离时的身份 */
export const accountUserId = (accountId: string) => hash(`mote-account:${accountId}`);

export const userDir = (userId: string) => inside(dataDir, "users", userId);
export const mediaPrefix = (userId: string) => `users/${userId}/`;

const verified = new Set<string>();

/** 按 Key 隔离:首次出现的 Key 先到中转站验证,确认有效才建立空间,避免随便填的 Key 占用存储。 */
async function ensureKeyUser(apiKey: string, userId: string) {
  if (verified.has(userId)) return;
  const profile = inside(userDir(userId), "profile.json");
  const known = await access(profile).then(() => true, () => false);
  if (!known) {
    const response = await fetch(`${TANGZHI_BASE_URL}/v1/models`, {
      headers: { Authorization: `Bearer ${apiKey}` }, cache: "no-store", signal: AbortSignal.timeout(15_000),
    }).catch(() => { throw new Error("暂时无法连接中转站验证 API Key，请稍后重试"); });
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

async function resolveUserId(apiKey: string) {
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
  return { apiKey, userId: await resolveUserId(apiKey) };
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
