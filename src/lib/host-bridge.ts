/**
 * 与宿主(Infinite-Canvas 首页)的通信。工作台以 iframe 嵌入且与宿主同源,
 * 消息一律限定同源收发,避免被其他页面注入。
 */
export const EMBED_HOST = "infinite-canvas";
export const EMBED_SESSION_KEY = "mote-embed";
/** Infinite-Canvas 存放深浅色主题的 localStorage 键(与其 theme.js 一致) */
export const HOST_THEME_KEYS = ["studio_theme", "canvas_theme"] as const;

export type HostTheme = "light" | "dark";

export function isEmbedded() {
  return typeof document !== "undefined" && document.documentElement.dataset.embed === EMBED_HOST;
}

export function hostThemeToMote(theme: unknown) {
  return theme === "dark" ? "canvas-dark" : "canvas-light";
}

export function clampHostScale(value: unknown) {
  const scale = Number(value);
  return Number.isFinite(scale) && scale > 0 ? Math.max(0.58, Math.min(1.4, scale)) : null;
}

export function postToHost(message: Record<string, unknown>) {
  if (!isEmbedded()) return false;
  try {
    window.parent.postMessage(message, window.location.origin);
    return true;
  } catch {
    return false;
  }
}

export function onHostMessage(handler: (data: Record<string, unknown>) => void) {
  const listener = (event: MessageEvent) => {
    if (event.origin !== window.location.origin || !event.data || typeof event.data !== "object") return;
    handler(event.data as Record<string, unknown>);
  };
  window.addEventListener("message", listener);
  return () => window.removeEventListener("message", listener);
}

/**
 * 首帧前执行:识别嵌入模式,直接采用宿主的深浅色与界面缩放,避免先闪一下工作台自己的主题。
 * 只有“带 embed 参数进入过 + 确实在 iframe 里”才算嵌入;直接打开 /studio 不受影响。
 */
export const embedBootScript = `(function(){try{var r=document.documentElement;var q=new URLSearchParams(location.search).get("embed");if(q==="${EMBED_HOST}")sessionStorage.setItem("${EMBED_SESSION_KEY}",q);if(sessionStorage.getItem("${EMBED_SESSION_KEY}")!=="${EMBED_HOST}"||window.self===window.top)return;r.dataset.embed="${EMBED_HOST}";var t=localStorage.getItem("${HOST_THEME_KEYS[0]}")||localStorage.getItem("${HOST_THEME_KEYS[1]}");r.dataset.theme=t==="dark"?"canvas-dark":"canvas-light";try{var s=parseFloat(getComputedStyle(window.parent.document.documentElement).getPropertyValue("--studio-ui-scale"));if(s>0)r.style.setProperty("--mote-zoom",String(Math.max(0.58,Math.min(1.4,s))));}catch(e){}}catch(e){}})();`;
