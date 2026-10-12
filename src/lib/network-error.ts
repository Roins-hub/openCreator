/** 浏览器 fetch 在网络层失败时的原始报错(Chrome / Firefox / Safari 各不相同) */
const BROWSER_NETWORK_ERRORS = /^(Failed to fetch|NetworkError when attempting to fetch resource\.?|Load failed|Network request failed)$/i;

export const NETWORK_ERROR = "网络连接中断，请求没有到达服务器，请检查网络（或代理 / VPN）后重试";

/** 把浏览器英文网络报错换成中文提示,其他报错原样返回 */
export function readableError(message: string) {
  return BROWSER_NETWORK_ERRORS.test(message.trim()) ? NETWORK_ERROR : message;
}
