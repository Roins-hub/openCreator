import { lookup as dnsLookup, type LookupAddress } from "node:dns";
import { BlockList, isIP } from "node:net";
import { Agent, fetch as undiciFetch } from "undici";
import { TANGZHI_BASE_URL } from "./tangzhi";

/**
 * 中转站地址:默认是内置的 1xxai.com;用户可以在设置里改成自己的 new-api 兼容中转站,
 * 浏览器通过请求头 x-tangzhi-base 告诉服务端。
 * 服务端会替用户请求这个地址,所以自定义地址只允许 https、公网地址:
 * 解析出的 IP 落在内网/本机/云元数据等网段时直接拒绝(连接时再校验一次,防 DNS 重绑定)。
 */
export const RELAY_HEADER = "x-tangzhi-base";

export interface Relay {
  /** 不带末尾斜杠的地址,如 https://1xxai.com */
  base: string;
  custom: boolean;
}

export const DEFAULT_RELAY: Relay = { base: TANGZHI_BASE_URL, custom: false };

const blocked = new BlockList();
for (const [network, prefix] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16],
  ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15],
  ["198.51.100.0", 24], ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4],
] as const) blocked.addSubnet(network, prefix, "ipv4");
for (const [network, prefix] of [
  ["::", 128], ["::1", 128], ["fc00::", 7], ["fe80::", 10], ["ff00::", 8], ["64:ff9b::", 96], ["2001:db8::", 32],
] as const) blocked.addSubnet(network, prefix, "ipv6");

export function isPrivateAddress(address: string) {
  const family = isIP(address);
  if (family === 4) return blocked.check(address, "ipv4");
  if (family === 6) {
    // ::ffff:10.0.0.1 这类内嵌 IPv4 地址按 IPv4 判断
    const mapped = address.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i)?.[1];
    return mapped ? blocked.check(mapped, "ipv4") : blocked.check(address, "ipv6");
  }
  return true;
}

/** 校验并规范化用户填写的地址;不合法时抛出给用户看的提示。 */
export function normalizeRelayBase(input: string) {
  let url: URL;
  try { url = new URL(input.trim()); } catch { throw new Error("中转站地址格式不正确，例如 https://api.example.com"); }
  if (url.protocol !== "https:") throw new Error("中转站地址必须以 https:// 开头");
  if (url.username || url.password) throw new Error("中转站地址里不能包含账号密码");
  if (url.search || url.hash) throw new Error("中转站地址里不能包含 ? 或 # 后面的内容");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (isIP(host) ? isPrivateAddress(host) : /^(localhost|.*\.localhost|.*\.local|.*\.internal)$/i.test(host)) {
    throw new Error("不能使用内网或本机地址");
  }
  return `${url.origin}${url.pathname.replace(/\/+$/, "")}`;
}

export function relayOf(request: Request): Relay {
  const raw = request.headers.get(RELAY_HEADER)?.trim();
  if (!raw) return DEFAULT_RELAY;
  const base = normalizeRelayBase(raw);
  return base === DEFAULT_RELAY.base ? DEFAULT_RELAY : { base, custom: true };
}

export const relayHost = (relay: Relay) => new URL(relay.base).host;

type LookupCallback = (error: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => void;

/** 连接前解析域名,任何一个地址是内网就拒绝,并且只连校验过的地址 */
function guardedLookup(hostname: string, options: { all?: boolean } | number, callback: LookupCallback) {
  const wantAll = typeof options === "object" && Boolean(options.all);
  dnsLookup(hostname, { all: true }, (error, addresses) => {
    if (error) return callback(error, []);
    if (!addresses.length || addresses.some((item) => isPrivateAddress(item.address))) {
      const denied = Object.assign(new Error("中转站地址解析到了内网地址，已拒绝"), { code: "EPRIVATE" });
      return callback(denied, []);
    }
    if (wantAll) callback(null, addresses);
    else callback(null, addresses[0].address, addresses[0].family);
  });
}

const customAgent = new Agent({ connect: { lookup: guardedLookup as never }, headersTimeout: 60_000, bodyTimeout: 300_000 });

/** 请求中转站。自定义地址走带内网防护的连接,并且不跟随跳转。 */
export async function relayFetch(relay: Relay, path: string, init: RequestInit = {}): Promise<Response> {
  const url = `${relay.base}${path}`;
  if (!relay.custom) return fetch(url, { cache: "no-store", ...init });
  try {
    const response = await undiciFetch(url, {
      ...(init as object), redirect: "manual", dispatcher: customAgent,
    } as Parameters<typeof undiciFetch>[1]);
    if (response.status >= 300 && response.status < 400) throw new Error(`中转站返回了跳转（${response.status}），请填写最终地址`);
    return response as unknown as Response;
  } catch (error) {
    const cause = (error as { cause?: { message?: string } }).cause?.message;
    if (error instanceof Error && /^中转站/.test(error.message)) throw error;
    throw new Error(`无法连接自定义中转站：${cause || (error as Error).message}`);
  }
}
