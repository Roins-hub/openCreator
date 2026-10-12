import { saveAccount } from "./account-store";
import { accountUserId, authCookie, mergeAccountWorkspaces, sessionCookie } from "./identity";
import { ensureWorkspaceKey, logoutAccount, type RelaySession } from "./relay-auth";

/** 用户真实 IP:nginx 写入的 X-Real-IP,其次 X-Forwarded-For 的第一个 */
export function clientIp(request: Request) {
  return request.headers.get("x-real-ip")?.trim() ||
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || undefined;
}

/**
 * 中转站登录成功之后:取得(或创建)工作台令牌并加密保存,把以前粘贴 Key 留下的记录合并进账号,
 * 退出这次中转站会话,返回要写给浏览器的 Cookie。
 */
export async function completeLogin(session: RelaySession, request: Request) {
  try {
    const { tokenId, key, allKeys } = await ensureWorkspaceKey(session);
    const userId = accountUserId(session.accountId);
    await mergeAccountWorkspaces(session.accountId, userId, allKeys);
    await saveAccount(userId, { accountId: session.accountId, username: session.username, tokenId, key });
    const headers = new Headers();
    headers.append("Set-Cookie", await authCookie(userId, request));
    // <video>/<img> 取媒体时用的 Cookie
    headers.append("Set-Cookie", await sessionCookie(userId, request));
    return headers;
  } finally {
    await logoutAccount(session);
  }
}
