import { chatModelIds, type RelayModel } from "@/lib/chat-models";
import { normalizeApiKey } from "@/lib/providers";
import { blockedAddressMessage, resolveRelayTarget } from "@/lib/relay-target";

export const runtime = "nodejs";

const errorResponse = (message: string, status: number) =>
  Response.json({ error: message }, { status });

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse("请求内容不是有效的 JSON。", 400);
  }

  const input = body as { provider?: unknown; customUrl?: unknown; key?: unknown };
  const relay = resolveRelayTarget(input.provider, input.customUrl);
  if (!relay.ok) {
    return errorResponse(relay.error, 400);
  }

  const apiKey = normalizeApiKey(input.key);
  if (!apiKey || apiKey.length > 4096) {
    return errorResponse("请填写有效的 API Key。", 400);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);

  try {
    const upstream = await relay.fetch(`${relay.apiBase}/models`, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: "application/json",
      },
      cache: "no-store",
      signal: controller.signal,
    });

    const raw = await upstream.text();
    if (!upstream.ok) {
      let detail = raw.slice(0, 300);
      try {
        const parsed = JSON.parse(raw) as {
          error?: { message?: string } | string;
          message?: string;
        };
        detail =
          (typeof parsed.error === "string" ? parsed.error : parsed.error?.message) ??
          parsed.message ??
          detail;
      } catch {}

      return errorResponse(
        `中转站返回 ${upstream.status}${detail ? `：${detail}` : ""}`,
        upstream.status === 401 || upstream.status === 403 ? 401 : 502,
      );
    }

    const payload = JSON.parse(raw) as { data?: RelayModel[] };
    // 聊天只列文本模型:中转站同时提供的视频、图片生成模型不显示
    const models = chatModelIds(payload.data ?? []);

    return Response.json({ models }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      return errorResponse("连接中转站超时，请稍后重试。", 504);
    }
    if (error instanceof SyntaxError) {
      return errorResponse("中转站返回的不是有效的模型列表，请检查地址是否正确。", 502);
    }
    const blocked = blockedAddressMessage(error);
    if (blocked) return errorResponse(blocked, 400);
    return errorResponse("无法连接中转站，请检查其服务状态。", 502);
  } finally {
    clearTimeout(timeout);
  }
}
