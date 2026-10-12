"use client";

import { ExternalLink, LogIn, LogOut, RefreshCw } from "lucide-react";
import { logout, openAuthDialog, refreshAccount, useAccount } from "@/lib/account-client";

/** 侧栏底部:登录后显示账号与中转站余额,未登录显示登录按钮 */
export function AccountPanel() {
  const account = useAccount();
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
  return (
    <div className="account-panel">
      <div className="account-row">
        <span className="account-avatar" aria-hidden="true">{(account.username || "?").slice(0, 1).toUpperCase()}</span>
        <span className="account-name" title={account.username}>{account.username}</span>
      </div>
      {account.balance !== null && account.balance !== undefined && (
        <div className="account-balance">
          <span>余额</span>
          <b>{account.balance}</b>
        </div>
      )}
      <div className="account-actions">
        <a href={account.auth.topUpUrl} target="_blank" rel="noopener noreferrer"><ExternalLink size={12} /> 充值</a>
        <button type="button" onClick={() => void refreshAccount()} title="刷新余额"><RefreshCw size={12} /> 刷新</button>
        <button type="button" onClick={() => void logout()}><LogOut size={12} /> 退出</button>
      </div>
    </div>
  );
}
