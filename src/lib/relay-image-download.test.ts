import { describe, expect, it, vi } from "vitest";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const seen: { via: string; url: string; auth?: string }[] = [];

vi.mock("./relay", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./relay")>()),
  // 中转站自己域名下的图片:要带 Key
  relayFetch: async (_relay: unknown, path: string, init: RequestInit = {}) => {
    seen.push({ via: "relay", url: path, auth: (init.headers as Record<string, string>).Authorization });
    return new Response(PNG, { headers: { "content-type": "image/png" } });
  },
  publicFetch: async (url: string) => {
    seen.push({ via: "public", url });
    if (url.includes("octet")) return new Response(PNG, { headers: { "content-type": "application/octet-stream" } });
    if (url.includes("html")) return new Response("<html>login</html>", { headers: { "content-type": "text/html; charset=utf-8" } });
    return new Response("forbidden", { status: 403 });
  },
}));

const { downloadRelayImage } = await import("./tangzhi-server");
const relay = { base: "https://relay.example.com", custom: true };

describe("downloading the image a relay returns", () => {
  it("recognises a PNG labelled as application/octet-stream", async () => {
    const result = await downloadRelayImage("https://cdn.example.com/octet.png", relay, "sk-1");
    expect(result.mimeType).toBe("image/png");
  });

  it("fetches relative and same-host links with the key", async () => {
    seen.length = 0;
    await downloadRelayImage("/v1/files/abc/content", relay, "sk-1");
    await downloadRelayImage("https://relay.example.com/img/x.png?sig=1", relay, "sk-1");
    expect(seen).toEqual([
      { via: "relay", url: "/v1/files/abc/content", auth: "Bearer sk-1" },
      { via: "relay", url: "/img/x.png?sig=1", auth: "Bearer sk-1" },
    ]);
  });

  it("explains what went wrong", async () => {
    await expect(downloadRelayImage("https://cdn.example.com/html", relay)).rejects.toThrow("中转站返回的不是图片（text/html");
    await expect(downloadRelayImage("https://cdn.example.com/denied", relay)).rejects.toThrow("HTTP 403");
  });

  it("decodes inline data URLs", async () => {
    const inline = `data:image/png;base64,${Buffer.from(PNG).toString("base64")}`;
    expect((await downloadRelayImage(inline, relay)).bytes).toEqual(PNG);
  });
});
