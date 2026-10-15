import { BlockList, isIPv4 } from "node:net";
import { Agent, buildConnector, fetch as undiciFetch } from "undici";
import {
  CUSTOM_PROVIDER_ID,
  customApiBase,
  isProviderId,
  providerApiBase,
} from "@/lib/providers";

// 自定义中转站由本服务端代为请求,必须挡住回环、内网、链路本地(含云厂商元数据)
// 等地址,否则任何人都能借这里访问服务器上只对本机开放的服务。
const blockedAddresses = new BlockList();
for (const [network, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["224.0.0.0", 3],
] as const) {
  blockedAddresses.addSubnet(network, prefix, "ipv4");
}
for (const [network, prefix] of [
  // 不要加 ::ffff:0:0/96:BlockList 会拿它去匹配所有 IPv4 地址。
  // IPv4 映射地址(::ffff:127.0.0.1)本身会按上面的 IPv4 规则检查。
  ["::", 96],
  ["64:ff9b::", 96],
  ["64:ff9b:1::", 48],
  ["100::", 64],
  ["2002::", 16],
  ["fc00::", 7],
  ["fe80::", 10],
  ["fec0::", 10],
  ["ff00::", 8],
] as const) {
  blockedAddresses.addSubnet(network, prefix, "ipv6");
}

const isPublicAddress = (address: string) => {
  const plain = address.replace(/%.*$/, "");
  return !blockedAddresses.check(plain, isIPv4(plain) ? "ipv4" : "ipv6");
};

class BlockedAddressError extends Error {
  constructor() {
    super("自定义中转站地址指向内网或保留地址，已拒绝连接。");
    this.name = "BlockedAddressError";
  }
}

// 在连接建立后、发出任何请求数据前核对对端 IP:DNS 重绑定、跳转到 IP 字面量
// 都要经过这里,比请求前单独解析一次域名更可靠。
const connectDirect = buildConnector({ timeout: 15_000 });
const customRelayAgent = new Agent({
  connect: (options, callback) =>
    connectDirect(options, (error, socket) => {
      if (error) return callback(error, null);
      if (!socket.remoteAddress || !isPublicAddress(socket.remoteAddress)) {
        socket.destroy();
        return callback(new BlockedAddressError(), null);
      }
      callback(null, socket);
    }),
});

const customRelayFetch: typeof fetch = (input, init) =>
  undiciFetch(input as Parameters<typeof undiciFetch>[0], {
    ...(init as Parameters<typeof undiciFetch>[1]),
    dispatcher: customRelayAgent,
  }) as unknown as Promise<Response>;

export function blockedAddressMessage(error: unknown) {
  for (let current = error; current instanceof Error; current = current.cause) {
    if (current instanceof BlockedAddressError) return current.message;
  }
  return null;
}

export type RelayTarget =
  | { ok: true; apiBase: string; fetch: typeof fetch }
  | { ok: false; error: string };

export function resolveRelayTarget(provider: unknown, customUrl: unknown): RelayTarget {
  if (provider === CUSTOM_PROVIDER_ID) {
    const apiBase = customApiBase(customUrl);
    return apiBase
      ? { ok: true, apiBase, fetch: customRelayFetch }
      : { ok: false, error: "请填写有效的自定义中转站地址（http 或 https）。" };
  }
  if (isProviderId(provider)) {
    return { ok: true, apiBase: providerApiBase(provider), fetch };
  }
  return { ok: false, error: "不支持的中转站。" };
}
