"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft, Check, CircleCheck, CircleX, Eye, EyeOff,
  LoaderCircle, Plus, RefreshCw, Save, TestTube2, Trash2, X,
} from "lucide-react";
import type { AppConfig, ModelConfig, ProviderConfig } from "@/lib/types";
import { createClientId } from "@/lib/client-id";
import { ThemePicker } from "@/components/theme-picker";
import { withBase } from "@/lib/base-path";

const id = () => createClientId();
const emptyModel = (): ModelConfig => ({
  id: id(), name: "", modelId: "", type: "chat",
  maxReferenceImages: 2, maxVideoDuration: 10, supportsImageInput: false,
});
const emptyProvider = (): ProviderConfig => ({
  id: id(), name: "", baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
  apiKey: "", apiType: "ark", models: [emptyModel()],
});

const PROVIDER_DEFAULT_URLS: Record<ProviderConfig["apiType"], string> = {
  ark: "https://ark.cn-beijing.volces.com/api/v3",
  openai: "https://api.openai.com/v1",
  dola: "https://dola.tangzhi.org/v1",
  jimeng: "https://visual.volcengineapi.com",
  kling: "https://api-singapore.klingai.com",
};

type SecretField = "apiKey" | "accessKeyId" | "secretAccessKey";

// 版本号在构建时由 next.config 注入；客户端直接读取内联值。
const appVersion = process.env.NEXT_PUBLIC_APP_VERSION || "dev";

export function SettingsForm() {
  const [config, setConfig] = useState<AppConfig>({ providers: [] });
  const [visible, setVisible] = useState<Record<string, boolean>>({});
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [tests, setTests] = useState<Record<string, { state: "loading" | "success" | "error"; message: string }>>({});
  const [syncing, setSyncing] = useState<Record<string, boolean>>({});

  useEffect(() => {
    fetch(withBase("/api/config")).then((response) => response.json()).then(setConfig)
      .catch(() => setError("无法读取配置"));
  }, []);

  const updateProvider = (index: number, patch: Partial<ProviderConfig>) => {
    setConfig((current) => ({
      providers: current.providers.map((provider, i) => i === index ? { ...provider, ...patch } : provider),
    }));
  };
  const updateModel = (providerIndex: number, modelIndex: number, patch: Partial<ModelConfig>) => {
    const provider = config.providers[providerIndex];
    updateProvider(providerIndex, {
      models: provider.models.map((model, i) => i === modelIndex ? { ...model, ...patch } : model),
    });
  };
  const save = async () => {
    setError(""); setStatus("");
    const response = await fetch(withBase("/api/config"), {
      method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(config),
    });
    const data = await response.json();
    if (!response.ok) return setError(data.error || "保存失败");
    setConfig(data); setVisible({}); setRevealed({}); setStatus("已保存");
    window.setTimeout(() => setStatus(""), 2000);
  };
  const toggleSecret = async (providerIndex: number, field: SecretField) => {
    const provider = config.providers[providerIndex];
    const key = `${provider.id}:${field}`;
    if (visible[key]) {
      setVisible((current) => ({ ...current, [key]: false }));
      if (revealed[key]) {
        updateProvider(providerIndex, { [field]: "••••••••" });
        setRevealed((current) => ({ ...current, [key]: false }));
      }
      return;
    }
    if (provider[field] !== "••••••••") {
      setVisible((current) => ({ ...current, [key]: true }));
      return;
    }
    try {
      const response = await fetch(withBase("/api/config/secret"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ providerId: provider.id }),
        cache: "no-store",
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "无法读取密钥");
      updateProvider(providerIndex, { [field]: data[field] || "" });
      setRevealed((current) => ({ ...current, [key]: true }));
      setVisible((current) => ({ ...current, [key]: true }));
    } catch (cause) {
      setError((cause as Error).message);
    }
  };
  const testModel = async (provider: ProviderConfig, model: ModelConfig) => {
    setTests((current) => ({ ...current, [model.id]: { state: "loading", message: "正在测试连接…" } }));
    try {
      const response = await fetch(withBase("/api/config/test"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider, modelId: model.id }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "连接测试失败");
      setTests((current) => ({ ...current, [model.id]: { state: "success", message: data.message } }));
    } catch (cause) {
      setTests((current) => ({
        ...current,
        [model.id]: { state: "error", message: (cause as Error).message },
      }));
    }
  };
  const syncModels = async (providerIndex: number) => {
    const provider = config.providers[providerIndex];
    setSyncing((current) => ({ ...current, [provider.id]: true }));
    setError(""); setStatus("");
    try {
      const response = await fetch(withBase("/api/config/models"), {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "同步模型失败");
      updateProvider(providerIndex, { models: data.models });
      setStatus(`已同步 ${data.count} 个模型`);
      window.setTimeout(() => setStatus(""), 2500);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setSyncing((current) => ({ ...current, [provider.id]: false }));
    }
  };

  return (
    <main className="settings-page">
      <header className="settings-top">
        <Link href="/" className="back-link"><ArrowLeft size={17} /> 返回对话</Link>
        <div className="settings-actions">
          {status && <span className="save-status"><Check size={14} />{status}</span>}
          <button className="primary-button" onClick={save}><Save size={15} /> 保存配置</button>
        </div>
      </header>

      <div className="settings-content">
        <div className="settings-title">
          <span className="eyebrow">LOCAL CONFIGURATION · v{appVersion}</span>
          <h1>设置</h1>
          <p>外观偏好保存在当前浏览器；模型密钥只保存在这台电脑的 <code>data/config.json</code> 中，不会发送到浏览器存储。</p>
        </div>
        {error && <div className="settings-error">{error}<button onClick={() => setError("")}><X size={14} /></button></div>}

        <ThemePicker />

        <section className="providers">
          {config.providers.map((provider, providerIndex) => (
            <article className="provider" key={provider.id}>
              <div className="provider-number">{String(providerIndex + 1).padStart(2, "0")}</div>
              <div className="provider-fields">
                <div className="section-head">
                  <h2>{provider.name || "未命名供应商"}</h2>
                  <button className="danger-link" onClick={() => setConfig({
                    providers: config.providers.filter((_, i) => i !== providerIndex),
                  })}><Trash2 size={14} /> 删除</button>
                </div>
                <div className="form-grid">
                  <label><span>供应商名称</span><input value={provider.name}
                    placeholder="火山方舟" onChange={(e) => updateProvider(providerIndex, { name: e.target.value })} /></label>
                  <label><span>接口类型</span><select value={provider.apiType}
                    onChange={(e) => {
                      const apiType = e.target.value as ProviderConfig["apiType"];
                      updateProvider(providerIndex, {
                        apiType,
                        baseUrl: PROVIDER_DEFAULT_URLS[apiType],
                      });
                    }}>
                    <option value="ark">火山方舟</option>
                    <option value="openai">OpenAI 兼容</option>
                    <option value="dola">Dola Pool 视频</option>
                    <option value="jimeng">即梦视觉（AK/SK）</option>
                    <option value="kling">可灵 API 2.0</option>
                  </select></label>
                  <label className="wide"><span>Base URL</span><input aria-label="Base URL"
                    value={provider.baseUrl}
                    placeholder={PROVIDER_DEFAULT_URLS[provider.apiType]}
                    onChange={(e) => updateProvider(providerIndex, { baseUrl: e.target.value })} /></label>
                  {provider.apiType === "jimeng" ? (
                    <>
                      {(["accessKeyId", "secretAccessKey"] as const).map((field) => {
                        const label = field === "accessKeyId" ? "Access Key ID" : "Secret Access Key";
                        const key = `${provider.id}:${field}`;
                        return <label className="wide" key={field}><span>{label}</span>
                          <div className="secret-input">
                            <input aria-label={label} type={visible[key] ? "text" : "password"}
                              value={provider[field] || ""} placeholder={`输入 ${label}`}
                              onChange={(e) => {
                                updateProvider(providerIndex, { [field]: e.target.value });
                                setRevealed((current) => ({ ...current, [key]: false }));
                              }} />
                            <button type="button" onClick={() => void toggleSecret(providerIndex, field)}
                              aria-label={visible[key] ? `隐藏 ${label}` : `显示 ${label}`}>
                              {visible[key] ? <EyeOff size={16} /> : <Eye size={16} />}
                            </button>
                          </div>
                        </label>;
                      })}
                    </>
                  ) : (
                    <label className="wide"><span>API Key</span><div className="secret-input">
                      <input aria-label="API Key"
                        type={visible[`${provider.id}:apiKey`] ? "text" : "password"}
                        value={provider.apiKey} placeholder="输入 API Key"
                        onChange={(e) => {
                          updateProvider(providerIndex, { apiKey: e.target.value });
                          setRevealed((current) => ({
                            ...current, [`${provider.id}:apiKey`]: false,
                          }));
                        }} />
                      <button type="button" onClick={() => void toggleSecret(providerIndex, "apiKey")}
                        aria-label={visible[`${provider.id}:apiKey`] ? "隐藏 API Key" : "显示 API Key"}
                        title="从本机配置中显示 API Key">
                        {visible[`${provider.id}:apiKey`] ? <EyeOff size={16} /> : <Eye size={16} />}
                      </button>
                    </div></label>
                  )}
                </div>

                <div className="models-head"><div><h3>模型</h3><span>{provider.models.length} 个</span></div>{provider.apiType === "dola" && (() => {
                  const ready = Boolean(provider.apiKey);
                  return <button className="sync-models" type="button" disabled={!ready || syncing[provider.id]} title={ready ? "从 Dola Pool /v1/models 获取模型" : "请先填写 API Key"} onClick={() => void syncModels(providerIndex)}><RefreshCw size={13} className={syncing[provider.id] ? "spin" : ""} /> 同步上游模型</button>;
                })()}</div>
                <div className="model-table">
                  <div className="model-row header">
                    <span>显示名称</span><span>Model ID</span><span>类型</span>
                    <span>参考图</span><span>视频秒数</span><span>连接</span><span />
                  </div>
                  {provider.models.map((model, modelIndex) => (
                    <div className="model-entry" key={model.id}>
                      <div className="model-row">
                      <input value={model.name} placeholder="Seedream 4.5"
                        onChange={(e) => updateModel(providerIndex, modelIndex, { name: e.target.value })} />
                      <input value={model.modelId} placeholder="doubao-seedream-4-5-251128"
                        onChange={(e) => updateModel(providerIndex, modelIndex, { modelId: e.target.value })} />
                      <select value={model.type}
                        onChange={(e) => {
                          const type = e.target.value as ModelConfig["type"];
                          updateModel(providerIndex, modelIndex, {
                            type,
                            // 切换类型时同步默认能力位:对话模型默认不支持图,图像/视频始终支持。
                            supportsImageInput: type !== "chat",
                          });
                        }}>
                        <option value="chat">对话</option><option value="image">图像</option><option value="video">视频</option>
                      </select>
                      {model.type === "chat" && !model.supportsImageInput ? (
                        <span className="not-applicable">—</span>
                      ) : (
                        <input className="reference-limit" type="number" min={0} max={8}
                          value={model.maxReferenceImages}
                          aria-label={`${model.name || "模型"}最大参考图数量`}
                          onChange={(e) => updateModel(providerIndex, modelIndex, {
                            maxReferenceImages: Math.min(8, Math.max(0, Number(e.target.value) || 0)),
                          })} />
                      )}
                      {model.type === "video" ? <input className="duration-limit" type="number" min={3} max={60}
                        value={model.maxVideoDuration}
                        aria-label={`${model.name || "模型"}最大视频时长`}
                        onChange={(e) => updateModel(providerIndex, modelIndex, {
                          maxVideoDuration: Math.min(60, Math.max(3, Number(e.target.value) || 3)),
                        })} /> : <span className="not-applicable">—</span>}
                      <button className={`test-model ${tests[model.id]?.state || ""}`}
                        disabled={tests[model.id]?.state === "loading"}
                        onClick={() => testModel(provider, model)}
                        aria-label={`测试 ${model.name || "模型"} 连接`}>
                        {tests[model.id]?.state === "loading" ? <LoaderCircle className="spin" size={14} /> :
                          tests[model.id]?.state === "success" ? <CircleCheck size={14} /> :
                          tests[model.id]?.state === "error" ? <CircleX size={14} /> :
                          <TestTube2 size={14} />}
                        测试
                      </button>
                      <button aria-label="删除模型" onClick={() => updateProvider(providerIndex, {
                        models: provider.models.filter((_, i) => i !== modelIndex),
                      })}><Trash2 size={15} /></button>
                      </div>
                      {model.type === "chat" && (
                        <label className="model-flag">
                          <input type="checkbox" checked={model.supportsImageInput}
                            aria-label={`${model.name || "模型"}支持图片输入`}
                            onChange={(e) => updateModel(providerIndex, modelIndex, {
                              supportsImageInput: e.target.checked,
                            })} />
                          支持图片输入（多模态视觉模型，如 GPT-4o / Claude / GLM-4V）
                        </label>
                      )}
                      {tests[model.id] && (
                        <div className={`model-test-result ${tests[model.id].state}`}>
                          {tests[model.id].message}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
                <button className="add-model" onClick={() => updateProvider(providerIndex, {
                  models: [...provider.models, emptyModel()],
                })}><Plus size={15} /> 添加模型</button>
              </div>
            </article>
          ))}
          <button className="add-provider" onClick={() => setConfig({ providers: [...config.providers, emptyProvider()] })}>
            <Plus size={18} /><span>添加供应商</span><small>同一个 URL 和 Key 下可以配置多个模型</small>
          </button>
        </section>
      </div>
    </main>
  );
}
