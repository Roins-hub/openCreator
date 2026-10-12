"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft, Check, CircleCheck, CircleX, ExternalLink, Eye, EyeOff, LoaderCircle, Save, TestTube2, X,
} from "lucide-react";
import {
  apiKeyHeaders, openSession, readApiKey, readRelayBase, writeApiKey, writeRelayBase,
} from "@/lib/api-key";
import {
  durationSummary, formatPrice, mediaSummary, TANGZHI_BASE_URL, TANGZHI_KEY_PAGE, type VideoModel,
} from "@/lib/tangzhi";
import { ThemePicker } from "@/components/theme-picker";

// 版本号在构建时由 next.config 注入；客户端直接读取内联值。
const appVersion = process.env.NEXT_PUBLIC_APP_VERSION || "dev";

export function SettingsForm() {
  const [apiKey, setApiKey] = useState("");
  const [saved, setSaved] = useState("");
  const [visible, setVisible] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [check, setCheck] = useState<{ state: "loading" | "success" | "error"; message: string }>();
  const [models, setModels] = useState<VideoModel[]>();
  // 中转站地址:空字符串 = 内置的默认中转站
  const [customMode, setCustomMode] = useState(false);
  const [baseInput, setBaseInput] = useState("");
  const [savedBase, setSavedBase] = useState("");
  const base = customMode ? baseInput.trim().replace(/\/+$/, "") : "";
  const host = (savedBase || TANGZHI_BASE_URL).replace(/^https?:\/\//, "");
  const keyPage = savedBase ? `${savedBase}/console/token` : TANGZHI_KEY_PAGE;

  const loadModels = (relayBase: string) => {
    setModels(undefined);
    fetch("/api/models", { headers: apiKeyHeaders("", relayBase) }).then(async (response) => {
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "无法获取模型列表");
      setModels(data);
    }).catch((cause) => setError((cause as Error).message));
  };

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const key = readApiKey();
      const relayBase = readRelayBase();
      setApiKey(key);
      setSaved(key);
      setSavedBase(relayBase);
      setBaseInput(relayBase);
      setCustomMode(Boolean(relayBase));
      loadModels(relayBase);
    }, 0);
    return () => clearTimeout(timer);
  }, []);

  const [saving, setSaving] = useState(false);
  const save = async () => {
    const key = apiKey.trim();
    setError("");
    if (customMode && !base) return setError("请填写自定义中转站地址，或切换回默认中转站");
    setSaving(true);
    try {
      // 先用新的地址和 Key 验证并切换到对应的个人空间,成功后才保存
      await openSession(key, base);
      writeRelayBase(base);
      writeApiKey(key);
      setApiKey(key);
      setSaved(key);
      if (base !== savedBase) loadModels(base);
      setSavedBase(base);
      setStatus(key ? "已保存" : "已清除");
      window.setTimeout(() => setStatus(""), 2000);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const verify = async () => {
    const key = apiKey.trim();
    if (!key) return setCheck({ state: "error", message: "请先填写 API Key" });
    setCheck({ state: "loading", message: "正在验证…" });
    try {
      const response = await fetch("/api/key-check", { method: "POST", headers: apiKeyHeaders(key, base) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "验证失败");
      setCheck({ state: "success", message: data.message });
    } catch (cause) {
      setCheck({ state: "error", message: (cause as Error).message });
    }
  };

  const dirty = apiKey.trim() !== saved || base !== savedBase;

  return (
    <main className="settings-page">
      <header className="settings-top">
        <Link href="/" className="back-link"><ArrowLeft size={17} /> 返回对话</Link>
        <div className="settings-actions">
          {status && <span className="save-status"><Check size={14} />{status}</span>}
          <button className="primary-button" onClick={() => void save()} disabled={!dirty || saving}>
            {saving ? <LoaderCircle className="spin" size={15} /> : <Save size={15} />} 保存
          </button>
        </div>
      </header>

      <div className="settings-content">
        <div className="settings-title">
          <span className="eyebrow">SETTINGS · v{appVersion}</span>
          <h1>设置</h1>
          <p>视频由 <code>{host}</code> 中转站生成。API Key 只保存在当前浏览器。{savedBase
            ? "使用自定义中转站时，对话和视频按「地址 + Key」单独存放，和默认中转站的记录互不相通。"
            : "对话和视频按中转站账号存放，其他用户看不到；同一账号下换一个 Key，记录也都还在。"}</p>
        </div>
        {error && <div className="settings-error">{error}<button onClick={() => setError("")}><X size={14} /></button></div>}

        <section className="settings-block" aria-labelledby="key-heading">
          <div className="provider-number">连接</div>
          <div>
            <div className="relay-choice" role="radiogroup" aria-label="中转站地址">
              <span className="relay-label">中转站地址</span>
              <button type="button" role="radio" aria-checked={!customMode}
                className={!customMode ? "active" : ""} onClick={() => { setCustomMode(false); setCheck(undefined); }}>
                默认 · {TANGZHI_BASE_URL.replace("https://", "")}
              </button>
              <button type="button" role="radio" aria-checked={customMode}
                className={customMode ? "active" : ""} onClick={() => { setCustomMode(true); setCheck(undefined); }}>
                自定义
              </button>
            </div>
            {customMode && <div className="relay-custom">
              <input aria-label="自定义中转站地址" value={baseInput} placeholder="https://api.example.com 或 https://api.example.com:8443"
                autoComplete="off" spellCheck={false} inputMode="url"
                onChange={(event) => { setBaseInput(event.target.value); setCheck(undefined); }}
                onKeyDown={(event) => { if (event.key === "Enter" && dirty) void save(); }} />
              <ul className="key-help relay-rules">
                <li>需要是 new-api 兼容的中转站，保存后模型列表会按新地址刷新。</li>
                <li>必须是 <code>https://</code> 地址；端口默认 443，其他端口写在域名后面，如 <code>https://api.example.com:8443</code>。</li>
                <li>不支持 <code>http://</code>：new-api 默认的 <code>http://服务器IP:3000</code> 不能直接用，请先给中转站配好域名和 HTTPS 证书。</li>
                <li>必须能从公网访问，不能是内网或本机地址（如 192.168.x.x、127.0.0.1、localhost）。</li>
              </ul>
            </div>}
            <div className="section-head">
              <h2 id="key-heading">中转站 API Key</h2>
              <a className="key-link" href={keyPage} target="_blank" rel="noopener noreferrer">
                获取 API Key <ExternalLink size={12} />
              </a>
            </div>
            <div className="key-row">
              <div className="secret-input">
                <input aria-label="API Key" type={visible ? "text" : "password"} value={apiKey}
                  placeholder="sk-…" autoComplete="off" spellCheck={false}
                  onChange={(event) => { setApiKey(event.target.value); setCheck(undefined); }}
                  onKeyDown={(event) => { if (event.key === "Enter" && dirty) void save(); }} />
                <button type="button" onClick={() => setVisible((value) => !value)}
                  aria-label={visible ? "隐藏 API Key" : "显示 API Key"}>
                  {visible ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
              <button type="button" className={`test-model ${check?.state || ""}`}
                disabled={check?.state === "loading"} onClick={() => void verify()}>
                {check?.state === "loading" ? <LoaderCircle className="spin" size={14} /> :
                  check?.state === "success" ? <CircleCheck size={14} /> :
                  check?.state === "error" ? <CircleX size={14} /> : <TestTube2 size={14} />}
                验证
              </button>
            </div>
            {check && check.state !== "loading" && <div className={`model-test-result ${check.state}`}>{check.message}</div>}
            <p className="key-help">登录 {host}，在「令牌」页面创建 API Key，复制后粘贴到这里并保存即可使用。</p>
          </div>
        </section>

        <section className="settings-block" aria-labelledby="models-heading">
          <div className="provider-number">模型</div>
          <div>
            <div className="section-head">
              <h2 id="models-heading">可用视频模型</h2>
              <span className="theme-note">{models ? `${models.length} 个 · 与中转站实时同步` : "加载中…"}</span>
            </div>
            <div className="catalog-table" role="table" aria-label="可用视频模型">
              <div className="catalog-row head" role="row">
                <span>模型</span><span>分辨率</span><span>时长</span><span>素材上限</span><span>价格</span>
              </div>
              {models?.map((model) => (
                <div className="catalog-row" role="row" key={model.id} title={model.description}>
                  <span><b>{model.id}</b>{model.face && <em>{model.face}</em>}</span>
                  <span>{model.resolution.toUpperCase()}</span>
                  <span>{durationSummary(model.durations)}</span>
                  <span>{mediaSummary(model.limits)}</span>
                  <span>{formatPrice(model)}</span>
                </div>
              ))}
            </div>
          </div>
        </section>

        <ThemePicker />
      </div>
    </main>
  );
}
