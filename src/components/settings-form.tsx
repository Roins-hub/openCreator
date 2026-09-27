"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft, Check, CircleCheck, CircleX, ExternalLink, Eye, EyeOff, LoaderCircle, Save, TestTube2, X,
} from "lucide-react";
import { apiKeyHeaders, readApiKey, writeApiKey } from "@/lib/api-key";
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

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const key = readApiKey();
      setApiKey(key);
      setSaved(key);
    }, 0);
    fetch("/api/models").then(async (response) => {
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "无法获取模型列表");
      setModels(data);
    }).catch((cause) => setError((cause as Error).message));
    return () => clearTimeout(timer);
  }, []);

  const save = () => {
    setError("");
    writeApiKey(apiKey);
    setApiKey(apiKey.trim());
    setSaved(apiKey.trim());
    setStatus(apiKey.trim() ? "已保存" : "已清除");
    window.setTimeout(() => setStatus(""), 2000);
  };

  const verify = async () => {
    const key = apiKey.trim();
    if (!key) return setCheck({ state: "error", message: "请先填写 API Key" });
    setCheck({ state: "loading", message: "正在验证…" });
    try {
      const response = await fetch("/api/key-check", { method: "POST", headers: apiKeyHeaders(key) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "验证失败");
      setCheck({ state: "success", message: data.message });
    } catch (cause) {
      setCheck({ state: "error", message: (cause as Error).message });
    }
  };

  const dirty = apiKey.trim() !== saved;

  return (
    <main className="settings-page">
      <header className="settings-top">
        <Link href="/" className="back-link"><ArrowLeft size={17} /> 返回对话</Link>
        <div className="settings-actions">
          {status && <span className="save-status"><Check size={14} />{status}</span>}
          <button className="primary-button" onClick={save} disabled={!dirty}><Save size={15} /> 保存</button>
        </div>
      </header>

      <div className="settings-content">
        <div className="settings-title">
          <span className="eyebrow">SETTINGS · v{appVersion}</span>
          <h1>设置</h1>
          <p>视频由 <code>{TANGZHI_BASE_URL.replace("https://", "")}</code> 中转站生成。API Key 只保存在当前浏览器，生成时经本站转发给中转站，不会写入服务器。</p>
        </div>
        {error && <div className="settings-error">{error}<button onClick={() => setError("")}><X size={14} /></button></div>}

        <section className="settings-block" aria-labelledby="key-heading">
          <div className="provider-number">连接</div>
          <div>
            <div className="section-head">
              <h2 id="key-heading">中转站 API Key</h2>
              <a className="key-link" href={TANGZHI_KEY_PAGE} target="_blank" rel="noopener noreferrer">
                获取 API Key <ExternalLink size={12} />
              </a>
            </div>
            <div className="key-row">
              <div className="secret-input">
                <input aria-label="API Key" type={visible ? "text" : "password"} value={apiKey}
                  placeholder="sk-…" autoComplete="off" spellCheck={false}
                  onChange={(event) => { setApiKey(event.target.value); setCheck(undefined); }}
                  onKeyDown={(event) => { if (event.key === "Enter") save(); }} />
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
            <p className="key-help">登录 {TANGZHI_BASE_URL.replace("https://", "")}，在「令牌」页面创建 API Key，复制后粘贴到这里并保存即可使用。</p>
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
