import type { ModelConfig, ProviderConfig } from "./types";
import { apiUrl, healthUrl } from "./providers/common";
import { signVolcengineRequest } from "./providers/volc-sign";

type Fetcher = (input: string, init?: RequestInit) => Promise<Response>;

export async function testProviderModel(
  provider: ProviderConfig,
  model: ModelConfig,
  fetcher: Fetcher = fetch,
) {
  if (provider.apiType === "kling") {
    const url = `${provider.baseUrl.replace(/\/+$/, "")}/tasks?task_ids=mote-connection-test`;
    const response = await fetcher(url, {
      method: "GET",
      headers: { Authorization: `Bearer ${provider.apiKey}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      if ([401, 403].includes(response.status)) throw new Error("API Key 无效或没有访问权限");
      throw new Error(`可灵接口返回 ${response.status}`);
    }
    const data = await response.json().catch(() => ({})) as { code?: number; message?: string };
    if (data.code !== 0) throw new Error(data.message || "可灵凭证测试失败");
    return `${model.name} 连接正常，API Key 可用；未发起付费生成`;
  }
  if (provider.apiType === "jimeng") {
    if (!provider.accessKeyId || !provider.secretAccessKey) {
      throw new Error("即梦视觉需要 Access Key ID 和 Secret Access Key");
    }
    const url = new URL(provider.baseUrl);
    url.pathname = "/";
    url.search = "";
    url.searchParams.set("Action", "CVSync2AsyncGetResult");
    url.searchParams.set("Version", "2022-08-31");
    const body = JSON.stringify({
      req_key: model.modelId,
      task_id: "mote-connection-test",
      req_json: JSON.stringify({ return_url: true }),
    });
    const headers = signVolcengineRequest({
      accessKeyId: provider.accessKeyId,
      secretAccessKey: provider.secretAccessKey,
      method: "POST",
      url,
      body,
      region: "cn-north-1",
      service: "cv",
    });
    const response = await fetcher(url.toString(), {
      method: "POST",
      headers,
      body,
      signal: AbortSignal.timeout(10_000),
    });
    const data = await response.json().catch(() => ({})) as { message?: string };
    if (!response.ok || /signature|access.?key|authorization|鉴权|签名|密钥|permission/i.test(data.message || "")) {
      if ([401, 403].includes(response.status)) throw new Error("AK/SK 无效或没有访问权限");
      throw new Error(data.message || `即梦视觉接口返回 ${response.status}`);
    }
    return `${model.name} 连接正常，AK/SK 凭证可用；未发起付费生成`;
  }
  const url = provider.apiType === "openai" || provider.apiType === "dola"
    ? apiUrl(provider.baseUrl, "models", "openai")
    : healthUrl(provider.baseUrl);
  const response = await fetcher(url, {
    method: "GET",
    headers: { Authorization: `Bearer ${provider.apiKey}` },
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw new Error("API Key 无效或没有访问权限");
    }
    throw new Error(`供应商接口返回 ${response.status}`);
  }
  if (provider.apiType === "openai" || provider.apiType === "dola") {
    const data = await response.json().catch(() => ({})) as {
      data?: Array<{ id?: string }>;
    };
    const ids = data.data?.map((item) => item.id) || [];
    if (!ids.includes(model.modelId)) {
      throw new Error(`供应商模型列表中没有找到模型 ${model.modelId}`);
    }
    return `${model.name} 连接正常，API Key 与模型可用；未发起付费生成`;
  }
  return `${model.name} 连接正常；未发起付费生成`;
}
