"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { LoaderCircle, X } from "lucide-react";
import { LogoMark } from "@/components/logo-mark";
import { onOpenAuthDialog, refreshAccount, useAccount, type AuthMode } from "@/lib/account-client";

declare global {
  interface Window {
    turnstile?: {
      render: (element: HTMLElement, options: Record<string, unknown>) => string;
      reset: (id: string) => void;
      remove: (id: string) => void;
    };
  }
}

const TURNSTILE_SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
let turnstileScript: Promise<void> | undefined;

function loadTurnstile() {
  turnstileScript ??= new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = TURNSTILE_SRC;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => { turnstileScript = undefined; reject(new Error("人机验证加载失败，请刷新重试")); };
    document.head.appendChild(script);
  });
  return turnstileScript;
}

/** 中转站开启人机验证时渲染 Turnstile;每个验证结果只能用一次,用过后 reset 再取新的 */
function useTurnstile(siteKey: string, ref: React.RefObject<HTMLDivElement | null>) {
  const widget = useRef<string>(undefined);
  const [token, setToken] = useState("");
  useEffect(() => {
    if (!siteKey || !ref.current) return;
    let cancelled = false;
    loadTurnstile().then(() => {
      if (cancelled || !ref.current || !window.turnstile) return;
      widget.current = window.turnstile.render(ref.current, {
        sitekey: siteKey,
        callback: (value: string) => setToken(value),
        "expired-callback": () => setToken(""),
        "error-callback": () => setToken(""),
      });
    }).catch(() => undefined);
    return () => {
      cancelled = true;
      if (widget.current) window.turnstile?.remove(widget.current);
      widget.current = undefined;
    };
  }, [siteKey, ref]);
  const reset = useCallback(() => {
    setToken("");
    if (widget.current) window.turnstile?.reset(widget.current);
  }, []);
  return { token, reset };
}

async function post<T>(url: string, body: unknown): Promise<T> {
  const response = await fetch(url, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "请求失败，请稍后重试");
  return data as T;
}

/** 全站唯一的登录/注册弹窗,通过 openAuthDialog() 打开 */
export function AuthDialogHost() {
  const [mode, setMode] = useState<AuthMode>();
  useEffect(() => onOpenAuthDialog(setMode), []);
  if (!mode) return null;
  return <AuthDialog mode={mode} onModeChange={setMode} onClose={() => setMode(undefined)} />;
}

function AuthDialog({ mode, onModeChange, onClose }: {
  mode: AuthMode; onModeChange: (mode: AuthMode) => void; onClose: () => void;
}) {
  const account = useAccount();
  const auth = account?.auth;
  const turnstileRef = useRef<HTMLDivElement>(null);
  const turnstileRequired = Boolean(auth?.turnstileSiteKey);
  const turnstile = useTurnstile(auth?.turnstileSiteKey || "", turnstileRef);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [affCode, setAffCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [cooldown, setCooldown] = useState(0);
  const register = mode === "register";

  useEffect(() => {
    const aff = new URLSearchParams(window.location.search).get("aff");
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 只在打开时读一次邀请码
    if (aff) setAffCode(aff.slice(0, 32));
  }, []);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = window.setTimeout(() => setCooldown((value) => value - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  const switchMode = (next: AuthMode) => {
    setError("");
    setNotice("");
    onModeChange(next);
  };

  async function sendCode() {
    setError("");
    if (!email.trim()) return setError("请先填写邮箱");
    if (turnstileRequired && !turnstile.token) return setError("请先完成人机验证");
    setBusy(true);
    try {
      await post("/api/auth/email-code", { email: email.trim(), turnstile: turnstile.token || undefined });
      setNotice("验证码已发送，请查收邮箱（可能在垃圾邮件里）");
      setCooldown(60);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      turnstile.reset();
      setBusy(false);
    }
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    setNotice("");
    if (register) {
      if (!/^[A-Za-z0-9_.-]{3,20}$/.test(username.trim())) return setError("用户名为 3-20 位字母、数字、下划线、点或短横线");
      if (password.length < 8) return setError("密码至少 8 位");
      if (password !== confirm) return setError("两次输入的密码不一致");
      if (auth?.emailVerification && (!email.trim() || !code.trim())) return setError("请填写邮箱和收到的验证码");
    } else if (!username.trim() || !password) {
      return setError("请输入账号和密码");
    }
    if (turnstileRequired && !turnstile.token) return setError("请先完成人机验证");
    setBusy(true);
    try {
      if (register) {
        const result = await post<{ loggedIn: boolean }>("/api/auth/register", {
          username: username.trim(), password, email: email.trim() || undefined, code: code.trim() || undefined,
          affCode: affCode.trim() || undefined, turnstile: turnstile.token || undefined,
        });
        if (!result.loggedIn) {
          // 人机验证只能用一次:注册完让用户再验证一次登录
          setConfirm("");
          setNotice("注册成功，请完成验证后登录");
          onModeChange("login");
          return;
        }
      } else {
        await post("/api/auth/login", { username: username.trim(), password, turnstile: turnstile.token || undefined });
      }
      await refreshAccount();
      onClose();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      turnstile.reset();
      setBusy(false);
    }
  }

  return (
    <div className="auth-overlay" onMouseDown={onClose}>
      <div className="auth-dialog" role="dialog" aria-modal="true" aria-labelledby="auth-title" onMouseDown={(event) => event.stopPropagation()}>
        <button className="icon-button auth-close" type="button" onClick={onClose} aria-label="关闭"><X size={17} /></button>
        <div className="auth-brand"><LogoMark size={24} /> Mote</div>
        <h2 id="auth-title">{register ? "创建账号" : "欢迎回来"}</h2>
        <p className="auth-sub">
          {register ? "注册后即可直接生成视频，账号同时可登录 " : "使用 "}
          <a href={auth?.relayUrl || "https://1xxai.com"} target="_blank" rel="noopener noreferrer">
            {(auth?.relayUrl || "https://1xxai.com").replace(/^https?:\/\//, "")}
          </a>
          {register ? "，余额两边通用。" : " 的账号登录，余额两边通用。"}
        </p>

        <form className="auth-form" onSubmit={submit} noValidate>
          <label className="auth-field">
            <span>{register ? "用户名" : "用户名或邮箱"}</span>
            <input value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="username"
              placeholder={register ? "3-20 位字母或数字" : "请输入用户名或邮箱"} maxLength={register ? 20 : 64} autoFocus />
          </label>
          <label className="auth-field">
            <span>密码</span>
            <input type="password" value={password} onChange={(event) => setPassword(event.target.value)}
              autoComplete={register ? "new-password" : "current-password"} placeholder={register ? "至少 8 位" : "请输入密码"} maxLength={64} />
          </label>
          {register && <>
            <label className="auth-field">
              <span>确认密码</span>
              <input type="password" value={confirm} onChange={(event) => setConfirm(event.target.value)}
                autoComplete="new-password" placeholder="请再次输入密码" maxLength={64} />
            </label>
            {auth?.emailVerification && <>
              <label className="auth-field">
                <span>邮箱</span>
                <input type="email" value={email} onChange={(event) => setEmail(event.target.value)}
                  autoComplete="email" placeholder="用于接收验证码和找回密码" maxLength={50} />
              </label>
              <label className="auth-field">
                <span>验证码</span>
                <div className="auth-code-row">
                  <input value={code} onChange={(event) => setCode(event.target.value)} inputMode="numeric"
                    autoComplete="one-time-code" placeholder="邮箱验证码" maxLength={32} />
                  <button type="button" className="auth-code-button" onClick={() => void sendCode()} disabled={busy || cooldown > 0}>
                    {cooldown > 0 ? `${cooldown} 秒后重发` : "发送验证码"}
                  </button>
                </div>
              </label>
            </>}
            <label className="auth-field">
              <span>邀请码 <em>选填</em></span>
              <input value={affCode} onChange={(event) => setAffCode(event.target.value)} placeholder="没有可不填" maxLength={32} />
            </label>
          </>}

          {turnstileRequired && <div className="auth-turnstile" ref={turnstileRef} />}
          {notice && <p className="auth-notice">{notice}</p>}
          {error && <p className="auth-error" role="alert">{error}</p>}

          <button className="auth-submit" type="submit" disabled={busy || (register && auth?.registerEnabled === false)}>
            {busy && <LoaderCircle size={15} className="spin" />}
            {register ? "注册并登录" : "登录"}
          </button>
        </form>

        <div className="auth-switch">
          {register ? (
            <>已有账号？<button type="button" onClick={() => switchMode("login")}>去登录</button></>
          ) : auth?.registerEnabled === false ? (
            <span>暂未开放注册</span>
          ) : (
            <>还没有账号？<button type="button" onClick={() => switchMode("register")}>立即注册</button></>
          )}
          {!register && (
            <a href={`${auth?.relayUrl || "https://1xxai.com"}/forgot-password`} target="_blank" rel="noopener noreferrer">忘记密码？</a>
          )}
        </div>
      </div>
    </div>
  );
}
