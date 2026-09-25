import { getConfig } from "@/lib/config-store";
import { failure, ok } from "@/lib/http";
import { providerConfigSchema } from "@/lib/schemas";
import type { ModelConfig, ProviderConfig } from "@/lib/types";

function modelIdOf(value: unknown) {
  if (typeof value === "string") return value.trim();
  if (!value || typeof value !== "object") return "";
  const item = value as Record<string, unknown>;
  return String(item.id || item.model || item.name || "").trim();
}

function normalizeModels(payload: unknown, provider: ProviderConfig): ModelConfig[] {
  const data = Array.isArray(payload)
    ? payload
    : payload && typeof payload === "object" && Array.isArray((payload as { data?: unknown }).data)
      ? (payload as { data: unknown[] }).data
      : [];
  const existing = new Map(provider.models.map((model) => [model.modelId, model]));
  return [...new Set(data.map(modelIdOf).filter(Boolean))].map((modelId) => {
    const old = existing.get(modelId);
    return old || {
      id: modelId,
      name: modelId,
      modelId,
      type: "video" as const,
      maxReferenceImages: provider.apiType === "dola" ? 8 : 2,
      maxVideoDuration: provider.apiType === "dola" ? 30 : 10,
      supportsImageInput: true,
    };
  });
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const saved = (await getConfig()).providers.find((item) => item.id === body.provider?.id);
    if (body.provider?.apiKey === "••••••••") body.provider.apiKey = saved?.apiKey || "";
    if (!body.provider?.apiKey) throw new Error("请先填写 API Key 或保存供应商配置");
    if (body.provider?.apiType === "dola" && Array.isArray(body.provider.models)) {
      body.provider.models = body.provider.models.filter((model: { name?: string; modelId?: string }) =>
        String(model.name || "").trim() && String(model.modelId || "").trim());
    }
    const provider = providerConfigSchema.parse(body.provider);
    if (provider.apiType !== "dola") throw new Error("当前自动同步只支持 Dola Pool 视频接口");

    const baseUrl = provider.baseUrl.replace(/\/+$/, "");
    const response = await fetch(`${baseUrl}/models`, {
      headers: { Authorization: `Bearer ${provider.apiKey}` },
      signal: AbortSignal.timeout(15_000),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload?.error?.message || payload?.message || `上游模型接口返回 ${response.status}`);
    }
    const models = normalizeModels(payload, provider);
    if (!models.length) throw new Error("上游没有返回可用模型");
    return ok({ models, count: models.length });
  } catch (error) { return failure(error); }
}
