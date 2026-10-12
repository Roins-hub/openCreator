import { failure, ok } from "@/lib/http";
import { relayFetch, relayOf } from "@/lib/relay";
import { API_KEY_HEADER } from "@/lib/identity";
import { upstreamMessage } from "@/lib/tangzhi-server";

/** 用 /v1/models 验证 API Key 是否可用(不产生费用)。 */
export async function POST(request: Request) {
  try {
    const key = request.headers.get(API_KEY_HEADER)?.trim();
    if (!key) throw new Error("请先填写 API Key");
    const response = await relayFetch(relayOf(request), "/v1/models", {
      headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(15_000),
    });
    const data = await response.json().catch(() => ({}));
    if (response.status === 401) throw new Error("API Key 无效或已过期");
    if (!response.ok) throw new Error(upstreamMessage(data, response.status));
    const count = Array.isArray(data?.data) ? data.data.length : 0;
    return ok({ message: count ? `API Key 可用，可调用 ${count} 个模型` : "API Key 可用" });
  } catch (error) { return failure(error); }
}
