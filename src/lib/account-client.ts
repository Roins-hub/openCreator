"use client";

import { useEffect, useSyncExternalStore } from "react";
import { readRelayBase, writeApiKey } from "./api-key";

/** 站内登录状态。账号和令牌都在服务端,这里只拿到用户名和余额。 */
export interface AccountAuthConfig {
  registerEnabled: boolean;
  emailVerification: boolean;
  /** 中转站开启人机验证时的站点 Key */
  turnstileSiteKey: string;
  topUpUrl: string;
  relayUrl: string;
}

export interface AccountInfo {
  loggedIn: boolean;
  username?: string;
  /** 已按中转站显示方式格式化;没配置余额查询时为 null */
  balance?: string | null;
  auth: AccountAuthConfig;
}

let current: AccountInfo | undefined;
let pending: Promise<AccountInfo> | undefined;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((listener) => listener());

export function refreshAccount(): Promise<AccountInfo> {
  pending ??= fetch("/api/account", { cache: "no-store" })
    .then(async (response) => {
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "读取账号信息失败");
      current = data as AccountInfo;
      emit();
      return current;
    })
    .catch((error) => {
      // 第一次就读取失败时按未登录处理,页面不至于一直停在加载中
      if (!current) {
        current = { loggedIn: false, auth: { registerEnabled: true, emailVerification: false, turnstileSiteKey: "", topUpUrl: "", relayUrl: "" } };
        emit();
      }
      throw error;
    })
    .finally(() => { pending = undefined; });
  return pending;
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
};

/** undefined = 还在读取 */
export function useAccount() {
  const account = useSyncExternalStore(subscribe, () => current, () => undefined);
  useEffect(() => {
    if (!current) refreshAccount().catch(() => undefined);
  }, []);
  return account;
}

/** 内置中转站改用账号登录后,清掉以前粘贴在浏览器里的 Key(自定义中转站的 Key 保留) */
export function clearBuiltinKey() {
  if (!readRelayBase()) writeApiKey("");
}

export async function logout() {
  await fetch("/api/auth/logout", { method: "POST" }).catch(() => undefined);
  clearBuiltinKey();
  await refreshAccount().catch(() => undefined);
}

// ---- 登录/注册弹窗由 AuthDialogHost 统一渲染,任何地方都能打开

export type AuthMode = "login" | "register";
const OPEN_EVENT = "mote-open-auth";

export function openAuthDialog(mode: AuthMode = "login") {
  window.dispatchEvent(new CustomEvent<AuthMode>(OPEN_EVENT, { detail: mode }));
}

export function onOpenAuthDialog(listener: (mode: AuthMode) => void) {
  const handler = (event: Event) => listener((event as CustomEvent<AuthMode>).detail);
  window.addEventListener(OPEN_EVENT, handler);
  return () => window.removeEventListener(OPEN_EVENT, handler);
}
