import { failure, ok } from "@/lib/http";
import { relayFetch, relayOf } from "@/lib/relay";
import { API_KEY_HEADER } from "@/lib/identity";
import { keyModelKind, upstreamMessage, type KeyModelKind } from "@/lib/tangzhi-server";

const PURPOSE_KIND: Record<string, Exclude<KeyModelKind, "other">> = { main: "video", image: "image", chat: "chat", assist: "chat" };
const KIND_NAME: Record<Exclude<KeyModelKind, "other">, string> = { video: "视频", image: "图片", chat: "对话" };

/**
 * 用 /v1/models 验证 API Key 是否可用(不产生费用),并按视频 / 图片 / 对话分类数一下:
 * 同一个 Key 往往几类都有;?purpose= 是这个 Key 在设置里的用途,这一类一个都没有时提示出来。
 */
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
    const list = Array.isArray(data?.data) ? data.data as Array<{ id?: unknown; supported_endpoint_types?: unknown }> : [];
    const counts: Record<KeyModelKind, number> = { video: 0, image: 0, chat: 0, other: 0 };
    for (const item of list) {
      if (typeof item.id !== "string" || !item.id) continue;
      const types = Array.isArray(item.supported_endpoint_types)
        ? item.supported_endpoint_types.filter((type): type is string => typeof type === "string") : [];
      counts[keyModelKind(item.id, types)] += 1;
    }
    if (!list.length) return ok({ message: "API Key 可用", counts });
    const summary = (["video", "image", "chat"] as const).map((kind) => `${KIND_NAME[kind]} ${counts[kind]}`).join(" · ");
    const wanted = PURPOSE_KIND[new URL(request.url).searchParams.get("purpose") || ""];
    const missing = wanted && !counts[wanted];
    return ok({
      message: missing
        ? `Key 可用，但没有可用的${KIND_NAME[wanted]}模型（${summary}）`
        : `API Key 可用：${summary} 个模型`,
      counts,
      ...(missing ? { warning: true } : {}),
    });
  } catch (error) { return failure(error); }
}
