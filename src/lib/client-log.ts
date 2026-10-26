"use client";

import { apiKeyHeaders, readApiKey } from "./api-key";

/** 浏览器上报的问题类型(服务端只认这几种) */
export type ClientIssue = "image-progress-fallback";

// 同一个页面里,同一种问题、同一个原因只报一次,不刷屏
const reported = new Set<string>();

/**
 * 把浏览器里发生的、用户不一定会反馈的问题报给服务端,记进工作台的服务日志
 * (例如原图没法边下边显示进度、只能直接加载)。失败了就算了,不影响页面。
 */
export function reportClientIssue(event: ClientIssue, reason: string, detail: Record<string, string | number | boolean> = {}) {
  const key = `${event}:${reason}`;
  if (reported.has(key) || typeof window === "undefined" || !readApiKey()) return;
  reported.add(key);
  void fetch("/api/client-log", {
    method: "POST",
    headers: { ...apiKeyHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify({ event, reason, origin: window.location.origin, online: navigator.onLine, ...detail }),
    keepalive: true,
  }).catch(() => undefined);
}
