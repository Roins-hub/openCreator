import { readAccount } from "@/lib/account-store";
import { failure, ok } from "@/lib/http";
import { authUserId } from "@/lib/identity";
import { accountQuota, formatQuota, relayStatus } from "@/lib/relay-auth";
import { TANGZHI_BASE_URL } from "@/lib/tangzhi";

/** 当前登录状态、余额,以及登录/注册框需要的中转站设置(未登录也能读)。 */
export async function GET(request: Request) {
  try {
    const status = await relayStatus().catch(() => null);
    const auth = {
      registerEnabled: status ? status.registerEnabled && status.passwordRegisterEnabled : true,
      emailVerification: status?.emailVerification ?? false,
      turnstileSiteKey: status?.turnstileSiteKey || "",
      topUpUrl: `${TANGZHI_BASE_URL}/console/topup`,
      relayUrl: TANGZHI_BASE_URL,
    };
    const userId = await authUserId(request);
    const account = userId ? await readAccount(userId) : null;
    if (!account) return ok({ loggedIn: false, auth });
    const quota = await accountQuota(account.accountId);
    return ok({
      loggedIn: true,
      username: account.username,
      balance: quota === null || !status ? null : formatQuota(quota, status),
      auth,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return failure(error, 500);
  }
}
