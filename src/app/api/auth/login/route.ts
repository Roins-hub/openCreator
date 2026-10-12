import { z } from "zod";
import { completeLogin, clientIp } from "@/lib/account-login";
import { failure, ok } from "@/lib/http";
import { loginAccount, RelayAuthError } from "@/lib/relay-auth";

const schema = z.object({
  username: z.string().trim().min(1, "请输入账号").max(64),
  password: z.string().min(1, "请输入密码").max(128),
  turnstile: z.string().max(4096).optional(),
});

/** 用中转站账号登录:中转站核对账号密码,本站保存为账号自动创建的令牌。 */
export async function POST(request: Request) {
  try {
    const input = schema.parse(await request.json());
    const ip = clientIp(request);
    const session = await loginAccount(input.username, input.password, input.turnstile, ip);
    const headers = await completeLogin(session, request);
    return ok({ username: session.username }, { headers });
  } catch (error) {
    return failure(error, error instanceof RelayAuthError ? error.status : 400);
  }
}
