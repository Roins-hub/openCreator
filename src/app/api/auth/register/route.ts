import { z } from "zod";
import { completeLogin, clientIp } from "@/lib/account-login";
import { failure, ok } from "@/lib/http";
import { loginAccount, registerAccount, relayStatus, RelayAuthError } from "@/lib/relay-auth";

const schema = z.object({
  username: z.string().trim().min(1, "请输入用户名").max(20, "用户名最多 20 个字符"),
  password: z.string().min(8, "密码至少 8 位").max(64, "密码最多 64 位"),
  email: z.string().trim().max(50).optional(),
  code: z.string().trim().max(32).optional(),
  affCode: z.string().trim().max(32).optional(),
  turnstile: z.string().max(4096).optional(),
});

/**
 * 在中转站注册账号(邮箱验证、新用户赠送额度、邀请返利等都按中转站的设置执行),然后直接登录。
 * 中转站开启人机验证时,一次验证只能用一次,注册后需要用户再验证一次登录。
 */
export async function POST(request: Request) {
  try {
    const input = schema.parse(await request.json());
    const ip = clientIp(request);
    await registerAccount(input, input.turnstile, ip);
    if ((await relayStatus()).turnstileSiteKey) return ok({ registered: true, loggedIn: false });
    const session = await loginAccount(input.username, input.password, undefined, ip);
    const headers = await completeLogin(session, request);
    return ok({ registered: true, loggedIn: true, username: session.username }, { headers });
  } catch (error) {
    return failure(error, error instanceof RelayAuthError ? error.status : 400);
  }
}
