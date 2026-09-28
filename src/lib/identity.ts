import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { access, mkdir, writeFile } from "node:fs/promises";
import { dataDir, inside } from "./paths";
import { sessionSecret } from "./session-secret";
import { TANGZHI_BASE_URL } from "./tangzhi";

/**
 * 用户身份 = 中转站 API Key 的哈希。服务器只保存哈希,不保存 Key;
 * 同一个 Key 在任何设备上看到同一份记录,不同 Key 的数据互相隔离。
 */
export const API_KEY_HEADER = "x-tangzhi-key";
export const SESSION_COOKIE = "mote_uid";

export interface User { apiKey: string; userId: string }

export function userIdOf(apiKey: string) {
  return createHash("sha256").update(`mote:${apiKey.trim()}`).digest("hex").slice(0, 32);
}

export const userDir = (userId: string) => inside(dataDir, "users", userId);
export const mediaPrefix = (userId: string) => `users/${userId}/`;

const verified = new Set<string>();

/** 首次出现的 Key 先到中转站验证,确认有效才建立空间,避免随便填的 Key 占用存储。 */
async function ensureUser(apiKey: string, userId: string) {
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

export async function requireUser(request: Request): Promise<User> {
  const apiKey = request.headers.get(API_KEY_HEADER)?.trim();
  if (!apiKey) throw new Error("请先在设置中填写中转站 API Key");
  const userId = userIdOf(apiKey);
  await ensureUser(apiKey, userId);
  return { apiKey, userId };
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
