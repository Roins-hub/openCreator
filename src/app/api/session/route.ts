import { failure, ok } from "@/lib/http";
import { clearSessionCookie, requireUser, sessionCookie } from "@/lib/identity";

/** 用 API Key 换取看媒体用的签名 Cookie(Key 本身不写入 Cookie)。 */
export async function POST(request: Request) {
  try {
    const { userId } = await requireUser(request);
    return ok({ ok: true }, { headers: { "Set-Cookie": await sessionCookie(userId, request) } });
  } catch (error) { return failure(error, 401); }
}

export async function DELETE() {
  return ok({ ok: true }, { headers: { "Set-Cookie": clearSessionCookie() } });
}
