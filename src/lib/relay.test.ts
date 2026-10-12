import { describe, expect, it } from "vitest";
import { DEFAULT_RELAY, isPrivateAddress, normalizeRelayBase, relayFetch, relayOf } from "./relay";

const withBase = (base?: string) => new Request("https://vip.example/api", { headers: base ? { "x-tangzhi-base": base } : {} });

describe("custom relay address", () => {
  it("uses the built-in relay unless the browser sends another address", () => {
    expect(relayOf(withBase())).toBe(DEFAULT_RELAY);
    expect(relayOf(withBase("https://new.tangzhi.org/"))).toBe(DEFAULT_RELAY);
    expect(relayOf(withBase("https://api.example.com/v/"))).toEqual({ base: "https://api.example.com/v", custom: true });
  });

  it("only accepts public https addresses", () => {
    expect(() => normalizeRelayBase("http://api.example.com")).toThrow(/https/);
    expect(() => normalizeRelayBase("not a url")).toThrow(/格式/);
    expect(() => normalizeRelayBase("https://user:pw@api.example.com")).toThrow(/账号密码/);
    for (const host of ["127.0.0.1", "10.1.2.3", "172.18.0.2", "192.168.1.1", "169.254.169.254", "[::1]", "localhost", "db.internal"]) {
      expect(() => normalizeRelayBase(`https://${host}:5433`)).toThrow(/内网/);
    }
    expect(normalizeRelayBase("https://8.8.8.8")).toBe("https://8.8.8.8");
    expect(normalizeRelayBase("https://api.example.com:8443/")).toBe("https://api.example.com:8443");
    expect(normalizeRelayBase("https://api.example.com:443")).toBe("https://api.example.com");
  });

  it("classifies private addresses, including IPv4-mapped IPv6", () => {
    expect(isPrivateAddress("100.64.1.1")).toBe(true);
    expect(isPrivateAddress("::ffff:127.0.0.1")).toBe(true);
    expect(isPrivateAddress("fd00::1")).toBe(true);
    expect(isPrivateAddress("1.1.1.1")).toBe(false);
    expect(isPrivateAddress("2606:4700:4700::1111")).toBe(false);
  });

  it("refuses to connect when a custom domain resolves to an internal address", async () => {
    // localtest.me 是公共的回环测试域名,解析到 127.0.0.1;本地没网时 DNS 失败也会被拒绝
    await expect(relayFetch({ base: "https://localtest.me", custom: true }, "/v1/models")).rejects.toThrow(/自定义中转站/);
  });
});
