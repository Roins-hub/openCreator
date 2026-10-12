import { z } from "zod";
import { clientIp } from "@/lib/account-login";
import { failure, ok } from "@/lib/http";
import { RelayAuthError, sendEmailCode } from "@/lib/relay-auth";

const schema = z.object({
  email: z.email("邮箱格式不正确").max(50),
  turnstile: z.string().max(4096).optional(),
});

/** 让中转站给注册邮箱发验证码 */
export async function POST(request: Request) {
  try {
    const input = schema.parse(await request.json());
    await sendEmailCode(input.email, input.turnstile, clientIp(request));
    return ok({ ok: true });
  } catch (error) {
    return failure(error, error instanceof RelayAuthError ? error.status : 400);
  }
}
