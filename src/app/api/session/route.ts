import { failure, ok } from "@/lib/http";
import { clearSessionCookie, requireUser, sessionCookie } from "@/lib/identity";
import { mediaOrigin } from "@/lib/object-store";

/**
 * 用 API Key 换取看媒体用的签名 Cookie(Key 本身不写入 Cookie)。
 * 顺带告诉页面媒体文件的域名,页面提前和它建好连接,第一张图不用再等握手。
 */
export async function POST(request: Request) {
  try {
    const { userId } = await requireUser(request);
    return ok({ ok: true, mediaOrigin: mediaOrigin() }, { headers: { "Set-Cookie": await sessionCookie(userId, request) } });
  } catch (error) { return failure(error, 401); }
}

export async function DELETE() {
  return ok({ ok: true }, { headers: { "Set-Cookie": clearSessionCookie() } });
}
