"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft, Check, CircleCheck, CircleX, ExternalLink, Eye, EyeOff, LoaderCircle, Save, TestTube2, X,
} from "lucide-react";
import {
  apiKeyHeaders, openSession, readAccountKey, readVideoKey, readAssistKey, readAssistModel, readChatKey, readImageKey, readRelayBase,
  writeAccountKey, writeApiKey, writeAssistKey, writeAssistModel, writeChatKey, writeImageKey, writeRelayBase,
} from "@/lib/api-key";
import { Dropdown } from "@/components/dropdown";
import {
  durationSummary, formatPrice, mediaSummary, TANGZHI_BASE_URL, TANGZHI_KEY_PAGE, type VideoModel,
} from "@/lib/tangzhi";
import { ThemePicker } from "@/components/theme-picker";
import { BackToTop } from "@/components/back-to-top";
import { readableError } from "@/lib/network-error";
import type { ImageModel } from "@/lib/image-models";

// 版本号在构建时由 next.config 注入；客户端直接读取内联值。
const appVersion = process.env.NEXT_PUBLIC_APP_VERSION || "dev";

type KeyCheck = { state: "loading" | "success" | "error"; message: string };

/** 一个 API Key 输入框:显示 / 隐藏、验证(只读模型列表,不产生费用) */
function KeyField({ id, label, note, value, placeholder, check, onChange, onVerify, onEnter, children }: {
  id: string;
  label: string;
  note: string;
  value: string;
  placeholder: string;
  check?: KeyCheck;
  onChange: (value: string) => void;
  onVerify: () => void;
  onEnter: () => void;
  children?: React.ReactNode;
}) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="key-field" aria-labelledby={id}>
      <div className="key-field-head">
        <h3 id={id}>{label}</h3>
        <span>{note}</span>
      </div>
      <div className="key-row">
        <div className="secret-input">
          <input aria-label={label} type={visible ? "text" : "password"} value={value}
            placeholder={placeholder} autoComplete="off" spellCheck={false}
            onChange={(event) => onChange(event.target.value)}
            onKeyDown={(event) => { if (event.key === "Enter") onEnter(); }} />
          <button type="button" onClick={() => setVisible((current) => !current)}
            aria-label={visible ? `隐藏${label}` : `显示${label}`}>
            {visible ? <EyeOff size={16} /> : <Eye size={16} />}
          </button>
        </div>
        <button type="button" className={`test-model ${check?.state || ""}`}
          disabled={check?.state === "loading"} onClick={onVerify}>
          {check?.state === "loading" ? <LoaderCircle className="spin" size={14} /> :
            check?.state === "success" ? <CircleCheck size={14} /> :
            check?.state === "error" ? <CircleX size={14} /> : <TestTube2 size={14} />}
          验证
        </button>
      </div>
      {check && check.state !== "loading" && <div className={`model-test-result ${check.state}`}>{check.message}</div>}
      {children}
    </div>
  );
}

type KeyKind = "account" | "main" | "image" | "chat" | "assist";

export function SettingsForm() {
  const [apiKey, setApiKey] = useState("");
  const [saved, setSaved] = useState("");
  // 图片 / 聊天 / 提示词优化单独用的 Key(选填;图片、聊天空 = 用视频的,提示词优化空 = 先用聊天的,再用视频的)
  // 自定义中转站的主 Key(选填):对话和资产按它存放,其余 Key 没填时也用它
  const [accountKey, setAccountKey] = useState("");
  const [savedAccountKey, setSavedAccountKey] = useState("");
  const [imageKey, setImageKey] = useState("");
  const [savedImageKey, setSavedImageKey] = useState("");
  const [chatKey, setChatKey] = useState("");
  const [savedChatKey, setSavedChatKey] = useState("");
  const [assistKey, setAssistKey] = useState("");
  const [savedAssistKey, setSavedAssistKey] = useState("");
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [checks, setChecks] = useState<Record<KeyKind, KeyCheck | undefined>>({
    account: undefined, main: undefined, image: undefined, chat: undefined, assist: undefined,
  });
  const setCheck = (which: KeyKind, value: KeyCheck | undefined) =>
    setChecks((current) => ({ ...current, [which]: value }));
  const [models, setModels] = useState<VideoModel[]>();
  const [imageModels, setImageModels] = useState<ImageModel[]>([]);
  // 提示词优化模型:"" = 自动
  const [assistModel, setAssistModel] = useState("");
  // source:这份选项是用哪个 Key + 中转站读的;和当前不一致时视为还在加载
  const [assistLoaded, setAssistLoaded] = useState<{ source: string; models: string[]; auto?: string }>();
  const [assistSaved, setAssistSaved] = useState(false);
  // 中转站地址:空字符串 = 内置的默认中转站
  const [customMode, setCustomMode] = useState(false);
  const [baseInput, setBaseInput] = useState("");
  const [savedBase, setSavedBase] = useState("");
  const base = customMode ? baseInput.trim().replace(/\/+$/, "") : "";
  const host = (savedBase || TANGZHI_BASE_URL).replace(/^https?:\/\//, "");
  const keyPage = savedBase ? `${savedBase}/console/token` : TANGZHI_KEY_PAGE;

  // 自定义中转站的模型按 Key 读取(/v1/models):视频模型用视频的 Key,生图模型用图片的 Key;
  // 只填了图片 Key 时只列生图模型
  const loadModels = (relayBase: string, videoKey: string, imageModelKey: string) => {
    setModels(undefined);
    const headers = apiKeyHeaders(videoKey || imageModelKey, relayBase, imageModelKey, !videoKey && Boolean(imageModelKey));
    fetch("/api/models", { headers }).then(async (response) => {
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "无法获取模型列表");
      const list = data as (VideoModel | ImageModel)[];
      setModels(list.filter((model): model is VideoModel => model.type === "video"));
      setImageModels(list.filter((model): model is ImageModel => model.type === "image"));
    }).catch((cause) => setError((cause as Error).message));
  };

  // 优化模型的选项按提示词优化实际用的 Key 列出(Key 所在分组决定能用哪些模型);保存了别的 Key 后重新读取
  const [ready, setReady] = useState(false);
  const assistKeyInUse = savedAssistKey || savedChatKey || saved || (savedBase ? savedAccountKey : "") || savedImageKey;
  const assistSource = `${savedBase}|${assistKeyInUse}`;
  const assistOptions = assistLoaded?.source === assistSource ? assistLoaded : undefined;
  useEffect(() => {
    if (!ready) return;
    const controller = new AbortController();
    const source = `${savedBase}|${assistKeyInUse}`;
    fetch("/api/prompt-assist", { headers: apiKeyHeaders(assistKeyInUse, savedBase), signal: controller.signal })
      .then(async (response) => setAssistLoaded({ source, ...(response.ok ? await response.json() : { models: [] }) }))
      .catch(() => { if (!controller.signal.aborted) setAssistLoaded({ source, models: [] }); });
    return () => controller.abort();
  }, [ready, assistKeyInUse, savedBase]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const key = readVideoKey();
      const relayBase = readRelayBase();
      setApiKey(key);
      setSaved(key);
      setAccountKey(readAccountKey());
      setSavedAccountKey(readAccountKey());
      setImageKey(readImageKey());
      setSavedImageKey(readImageKey());
      setChatKey(readChatKey());
      setSavedChatKey(readChatKey());
      setAssistKey(readAssistKey());
      setSavedAssistKey(readAssistKey());
      setSavedBase(relayBase);
      setBaseInput(relayBase);
      setCustomMode(Boolean(relayBase));
      setAssistModel(readAssistModel());
      loadModels(relayBase, key || (relayBase ? readAccountKey() : ""), readImageKey());
      setReady(true);
    }, 0);
    return () => clearTimeout(timer);
  }, []);

  const [saving, setSaving] = useState(false);
  const save = async () => {
    const key = apiKey.trim();
    // 自定义中转站的主 Key:对话和资产按它存放;视频没填时调用中转站也用它
    const account = customMode ? accountKey.trim() : "";
    // 调用中转站的 Key:视频,没填时主 Key,再没有就图片(只填图片时对话和资产存在图片 Key 的空间)
    const callKey = key || account || imageKey.trim();
    setError("");
    if (customMode && !base) return setError("请填写自定义中转站地址，或切换回默认中转站");
    setSaving(true);
    try {
      // 先用新的地址和 Key 验证并切换到对应的个人空间,成功后才保存
      await openSession(callKey, base, account);
      writeRelayBase(base);
      writeApiKey(key);
      setApiKey(key);
      setSaved(key);
      writeAccountKey(accountKey);
      setSavedAccountKey(accountKey.trim());
      writeImageKey(imageKey);
      writeChatKey(chatKey);
      writeAssistKey(assistKey);
      setSavedImageKey(imageKey.trim());
      setSavedChatKey(chatKey.trim());
      setSavedAssistKey(assistKey.trim());
      if (base !== savedBase || key !== saved || imageKey.trim() !== savedImageKey || accountKey.trim() !== savedAccountKey) {
        loadModels(base, key || account, imageKey.trim());
      }
      setSavedBase(base);
      setStatus(callKey ? "已保存" : "已清除");
      window.setTimeout(() => setStatus(""), 2000);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setSaving(false);
    }
  };

  /** 验证某个 Key:选填的没填时验证它实际会用的 Key(提示词优化 → 聊天 → 视频;图片 → 视频) */
  const verify = async (which: KeyKind) => {
    const own = (which === "account" ? accountKey : which === "image" ? imageKey : which === "chat" ? chatKey
      : which === "assist" ? assistKey : apiKey).trim();
    const account = customMode ? accountKey.trim() : "";
    const fallbackToChat = which === "assist" && !own && Boolean(chatKey.trim());
    // 没填的按顺序兜底:聊天(提示词优化)→ 视频 → 主 Key(自定义中转站)→ 图片;视频没填又没主 Key 时只能生图
    const fallback = fallbackToChat ? chatKey.trim() : apiKey.trim() || account || imageKey.trim();
    const fallbackName = fallbackToChat ? "聊天" : apiKey.trim() ? "视频" : account ? "主" : "图片";
    const key = which === "account" ? own : which === "main" ? own || account : own || fallback;
    if (which === "account" && !own) return setCheck("account", { state: "error", message: "请先填写主 Key" });
    if (which === "main" && !own && !account) {
      return setCheck("main", imageKey.trim()
        ? { state: "error", message: "没有填写视频的 Key：只能生成图片，视频入口不可用" }
        : { state: "error", message: "视频和图片的 Key 至少填一个" });
    }
    if (!key) return setCheck(which, { state: "error", message: "请先填写 API Key" });
    setCheck(which, { state: "loading", message: "正在验证…" });
    try {
      // 按用途验证:同一个 Key 视频 / 图片 / 对话模型分开数,这个用途的一个都没有时标红
      const response = await fetch(`/api/key-check?purpose=${which}`, { method: "POST", headers: apiKeyHeaders(key, base, "") });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "验证失败");
      const prefix = own || which === "account" ? "" : `没有单独填写，使用${which === "main" ? "主" : fallbackName} Key：`;
      setCheck(which, { state: data.warning ? "error" : "success", message: `${prefix}${data.message}` });
    } catch (cause) {
      setCheck(which, { state: "error", message: (cause as Error).message });
    }
  };

  const dirty = apiKey.trim() !== saved || base !== savedBase || imageKey.trim() !== savedImageKey
    || (customMode && accountKey.trim() !== savedAccountKey)
    || chatKey.trim() !== savedChatKey || assistKey.trim() !== savedAssistKey;
  const saveIfDirty = () => { if (dirty) void save(); };

  return (
    <main className="settings-page">
      <header className="settings-top">
        <Link href="/" className="back-link"><ArrowLeft size={17} /> 返回对话</Link>
        <div className="settings-actions">
          {/* 和工作台一样在顶栏右侧;整页滚动,跟随窗口 */}
          <BackToTop />
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
          <p>视频和图片由 <code>{host}</code> 中转站生成。API Key 只保存在当前浏览器。{savedBase
            ? "使用自定义中转站时，对话、视频和图片按「地址 + Key」单独存放，和默认中转站的记录互不相通。"
            : "对话、聊天记录、视频和图片按中转站账号存放，其他用户看不到；同一账号下换一个 Key，记录也都还在。"}</p>
        </div>
        {error && <div className="settings-error">{readableError(error)}<button onClick={() => setError("")}><X size={14} /></button></div>}

        <section className="settings-block" aria-labelledby="key-heading">
          <div className="provider-number">连接</div>
          <div>
            <div className="relay-choice" role="radiogroup" aria-label="中转站地址">
              <span className="relay-label">中转站地址</span>
              <button type="button" role="radio" aria-checked={!customMode}
                className={!customMode ? "active" : ""} onClick={() => { setCustomMode(false); setCheck("main", undefined); }}>
                默认 · {TANGZHI_BASE_URL.replace("https://", "")}
              </button>
              <button type="button" role="radio" aria-checked={customMode}
                className={customMode ? "active" : ""} onClick={() => { setCustomMode(true); setCheck("main", undefined); }}>
                自定义
              </button>
            </div>
            {customMode && <div className="relay-custom">
              <input aria-label="自定义中转站地址" value={baseInput} placeholder="https://api.example.com 或 https://api.example.com:8443"
                autoComplete="off" spellCheck={false} inputMode="url"
                onChange={(event) => { setBaseInput(event.target.value); setCheck("main", undefined); }}
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
            <p className="key-help key-intro">
              登录 {host}，在「令牌」页面创建 API Key，粘贴到下面并保存。视频和图片至少填一个，几个用途可以用同一个 Key，也可以分开：
              视频和图片可以用不同分组的 Key；只填图片的 Key 时只能生图。聊天和提示词优化要用文本模型，如果 Key 所在分组没有文本模型，就给它们各填一个能用文本模型的 Key。
            </p>
            <div className="key-fields">
              {customMode && (
                <KeyField id="key-account" label="主 Key" note="自定义中转站 · 建议填写 · 对话和资产按这个 Key 隔离保存"
                  value={accountKey} placeholder="sk-…" check={checks.account} onEnter={saveIfDirty}
                  onChange={(value) => { setAccountKey(value); setCheck("account", undefined); }}
                  onVerify={() => void verify("account")}>
                  <p className="key-help">
                    自定义中转站查不到账号，数据只能按 Key 区分。填了主 Key，对话、资产、分组、提示词库和常用都固定存在它下面，换视频 / 图片 Key 也不会换空间；
                    下面的视频、图片、聊天 Key 没填时也用它。想沿用以前的数据，就把主 Key 填成以前存数据的那个 Key（一般是原来的视频 Key）。
                  </p>
                </KeyField>
              )}
              <KeyField id="key-main" label="视频"
                note={customMode ? "选填 · 不填就用主 Key · 生成视频" : "和图片至少填一个 · 生成视频，也用来存放你的对话和资产"}
                value={apiKey} placeholder="sk-…" check={checks.main} onEnter={saveIfDirty}
                onChange={(value) => { setApiKey(value); setCheck("main", undefined); }}
                onVerify={() => void verify("main")} />
              <KeyField id="key-image" label="图片" note="选填 · 不填就用视频的 Key；没填视频 Key 时必填"
                value={imageKey} placeholder="不填则沿用视频的 Key" check={checks.image} onEnter={saveIfDirty}
                onChange={(value) => { setImageKey(value); setCheck("image", undefined); }}
                onVerify={() => void verify("image")}>
                <p className="key-help">生图和输入框里的生图模型列表都用这个 Key；自定义中转站按这个 Key 的 /v1/models 列出能用的生图模型。填了视频 Key 时，生成的图片存在视频 Key 的账号下；只填图片 Key 时，对话和资产都存在图片 Key 的账号下（只能生图）。</p>
              </KeyField>
              <KeyField id="key-chat" label="聊天" note="选填 · 不填就用视频的 Key"
                value={chatKey} placeholder="不填则沿用上面的 Key" check={checks.chat} onEnter={saveIfDirty}
                onChange={(value) => { setChatKey(value); setCheck("chat", undefined); }}
                onVerify={() => void verify("chat")}>
                <p className="key-help">「聊天」页面的模型列表和回复都用这个 Key；聊天模型在聊天页面的输入框里选。</p>
              </KeyField>
              <KeyField id="key-assist" label="提示词优化" note="选填 · 不填就用聊天的 Key（聊天也没填则用视频的）"
                value={assistKey} placeholder="不填则沿用聊天的 Key" check={checks.assist} onEnter={saveIfDirty}
                onChange={(value) => { setAssistKey(value); setCheck("assist", undefined); }}
                onVerify={() => void verify("assist")}>
                <div className="assist-setting">
                  <span className="assist-label">优化模型{assistSaved && <em>已保存在当前浏览器</em>}</span>
                  <Dropdown className="assist-dropdown" ariaLabel="提示词优化模型"
                    placeholder={assistOptions ? "自动" : "正在加载模型"}
                    value={assistModel || "auto"}
                    options={[
                      { value: "auto", label: "自动", hint: assistOptions?.auto ? `现在会先用 ${assistOptions.auto}` : undefined },
                      ...(assistModel && assistOptions && !assistOptions.models.includes(assistModel)
                        ? [{ value: assistModel, label: assistModel, hint: "已下线" }] : []),
                      ...(assistOptions?.models || []).map((id) => ({ value: id, label: id, group: "文本模型" })),
                    ]}
                    onChange={(value) => {
                      const next = value === "auto" ? "" : value;
                      setAssistModel(next);
                      writeAssistModel(next);
                      setAssistSaved(true);
                    }} />
                  {assistOptions && !assistOptions.models.length && (
                    <p className="key-help is-warning">
                      当前用的 Key 没有可用的对话模型（Key 所在分组里没有）。给提示词优化或聊天填一个能用对话模型的 Key 并保存后，这里就能选了。
                    </p>
                  )}
                  <p className="key-help">
                    输入框的 ✨ 按钮用它扩写提示词，可选的模型就是这个 Key 能用的对话模型。「自动」会先用轻量便宜的模型（名字带 luna、mini、flash 等），某个模型暂时不可用时自动换下一个；
                    选了具体模型后只用它，它不可用时会直接提示。费用按中转站的文本模型价格从这个 Key 扣除。
                  </p>
                </div>
              </KeyField>
            </div>
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
                  <span>{model.resolutions.map((item) => item.toUpperCase()).join(" / ")}</span>
                  <span>{durationSummary(model.durations)}</span>
                  <span>{mediaSummary(model.limits)}</span>
                  <span>{formatPrice(model)}</span>
                </div>
              ))}
            </div>
            {imageModels.length > 0 && <>
              <div className="section-head catalog-subhead">
                <h2>可用生图模型</h2>
                <span className="theme-note">{imageModels.length} 个 · 文生图、图生图（最多 20 张参考图）</span>
              </div>
              <div className="catalog-table catalog-table-image" role="table" aria-label="可用生图模型">
                <div className="catalog-row head" role="row"><span>模型</span><span>说明</span><span>价格</span></div>
                {imageModels.map((model) => (
                  <div className="catalog-row" role="row" key={model.id}>
                    <span><b>{model.id}</b></span>
                    <span>{model.description || "—"}</span>
                    <span>{model.priceDetail}</span>
                  </div>
                ))}
              </div>
            </>}
          </div>
        </section>

        <ThemePicker />
      </div>
    </main>
  );
}
