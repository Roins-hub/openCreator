"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronsUpDown, ExternalLink, LogIn, LogOut, RefreshCw } from "lucide-react";
import { logout, openAuthDialog, refreshAccount, useAccount } from "@/lib/account-client";

/** 刷新图标最少转动的时间,和 .account-refresh-spin 的一圈时长一致 */
const MIN_SPIN_MS = 600;

/** 侧栏底部:登录后只显示头像和用户名,点开菜单查看余额、充值或退出;未登录显示登录按钮 */
export function AccountPanel() {
  const account = useAccount();
  const [open, setOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    // 余额接口通常几十毫秒就返回,至少转满一圈,点击才有反馈
    await Promise.all([
      refreshAccount().catch(() => undefined),
      new Promise((resolve) => setTimeout(resolve, MIN_SPIN_MS)),
    ]);
    setRefreshing(false);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  if (!account) return null;
  if (!account.loggedIn) {
    return (
      <div className="account-panel">
        <button type="button" className="account-login" onClick={() => openAuthDialog("login")}>
          <LogIn size={15} /> 登录 / 注册
        </button>
      </div>
    );
  }

  const name = account.username || "";
  return (
    <div className={`account-panel ${open ? "is-open" : ""}`} ref={rootRef}>
      <button type="button" className="account-trigger" aria-haspopup="menu" aria-expanded={open}
        onClick={() => {
          // 每次打开菜单顺手刷新余额
          if (!open) void refresh();
          setOpen((value) => !value);
        }}>
        <span className="account-avatar" aria-hidden="true">{name.slice(0, 1).toUpperCase() || "?"}</span>
        <span className="account-name" title={name}>{name}</span>
        <ChevronsUpDown size={14} className="account-chevron" aria-hidden="true" />
      </button>

      {open && (
        <div className="account-menu" role="menu">
          <div className="account-menu-head">
            <b title={name}>{name}</b>
            <span>{account.auth.relayUrl.replace(/^https?:\/\//, "") || "中转站"} 账号</span>
          </div>
          <div className="account-menu-balance">
            <span>余额</span>
            <b>{account.balance ?? "—"}</b>
            <button type="button" className="icon-button" onClick={() => void refresh()}
              aria-label="刷新余额" title="刷新余额" disabled={refreshing}>
              <RefreshCw size={13} className={refreshing ? "account-refresh-spin" : ""} />
            </button>
          </div>
          <a className="history-action" role="menuitem" href={account.auth.topUpUrl} target="_blank" rel="noopener noreferrer"
            onClick={() => setOpen(false)}>
            <ExternalLink size={14} /> 充值
          </a>
          <div className="account-menu-divider" />
          <button type="button" className="history-action history-delete" role="menuitem"
            onClick={() => { setOpen(false); void logout(); }}>
            <LogOut size={14} /> 退出登录
          </button>
        </div>
      )}
    </div>
  );
}
