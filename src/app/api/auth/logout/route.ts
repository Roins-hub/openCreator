import { ok } from "@/lib/http";
import { clearAuthCookie, clearSessionCookie } from "@/lib/identity";

export async function POST() {
  const headers = new Headers();
  headers.append("Set-Cookie", clearAuthCookie());
  headers.append("Set-Cookie", clearSessionCookie());
  return ok({ ok: true }, { headers });
}
