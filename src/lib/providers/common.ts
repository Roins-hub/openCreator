import type { AppConfig, ModelConfig, ProviderApiType, ProviderConfig } from "../types";

export function apiUrl(baseUrl: string, path: string, apiType: ProviderApiType = "ark") {
  let base = baseUrl.replace(/\/+$/, "");
  if (apiType === "openai" || apiType === "dola") {
    base = base.replace(/\/(?:chat\/completions|models)$/i, "");
    return `${base}/${path.replace(/^\/+/, "")}`;
  }
  if (!/\/(?:api\/)?v\d+$/.test(base)) base += "/api/v3";
  return `${base}/${path.replace(/^\/+/, "")}`;
}

export function healthUrl(baseUrl: string) {
  return new URL("/ping", baseUrl).toString();
}

export function resolveModel(config: AppConfig, providerId: string, modelId: string): {
  provider: ProviderConfig; model: ModelConfig;
} {
  const provider = config.providers.find((item) => item.id === providerId);
  const model = provider?.models.find((item) => item.id === modelId);
  if (!provider || !model) throw new Error("找不到所选模型，请检查配置");
  return { provider, model };
}

export async function upstream(url: string, provider: ProviderConfig, init: RequestInit = {}) {
  const response = await fetch(url, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${provider.apiKey}`,
      ...init.headers,
    },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = data?.error?.message || data?.message || `模型服务返回 ${response.status}`;
    throw new Error(message);
  }
  return data;
}
