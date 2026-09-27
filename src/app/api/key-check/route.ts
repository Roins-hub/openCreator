import { failure, ok } from "@/lib/http";
import { TANGZHI_BASE_URL } from "@/lib/tangzhi";
import { requireApiKey, upstreamMessage } from "@/lib/tangzhi-server";

/** 用 /v1/models 验证 API Key 是否可用(不产生费用)。 */
export async function POST(request: Request) {
  try {
    const key = requireApiKey(request);
    const response = await fetch(`${TANGZHI_BASE_URL}/v1/models`, {
      headers: { Authorization: `Bearer ${key}` }, cache: "no-store", signal: AbortSignal.timeout(15_000),
    });
    const data = await response.json().catch(() => ({}));
    if (response.status === 401) throw new Error("API Key 无效或已过期");
    if (!response.ok) throw new Error(upstreamMessage(data, response.status));
    const count = Array.isArray(data?.data) ? data.data.length : 0;
    return ok({ message: count ? `API Key 可用，可调用 ${count} 个模型` : "API Key 可用" });
  } catch (error) { return failure(error); }
}
