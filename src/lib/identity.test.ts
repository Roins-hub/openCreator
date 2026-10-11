import { beforeAll, describe, expect, it } from "vitest";

beforeAll(() => {
  process.env.MOTE_SESSION_SECRET = "test-secret-test-secret-test-secret";
  delete process.env.R2_ENDPOINT;
  delete process.env.S3_ENDPOINT;
});

describe("identity", () => {
  it("derives a stable, key-specific user id", async () => {
    const { userIdOf } = await import("./identity");
    expect(userIdOf("sk-a")).toMatch(/^[0-9a-f]{32}$/);
    expect(userIdOf(" sk-a ")).toBe(userIdOf("sk-a"));
    expect(userIdOf("sk-b")).not.toBe(userIdOf("sk-a"));
  });

  it("accepts its own session cookie and rejects a forged one", async () => {
    const { sessionCookie, sessionUserId, userIdOf } = await import("./identity");
    const userId = userIdOf("sk-a");
    const cookie = (await sessionCookie(userId, new Request("https://vip.example/api/session"))).split(";")[0];
    expect(await sessionUserId(new Request("https://vip.example/", { headers: { cookie } }))).toBe(userId);
    const forged = `mote_uid=${userIdOf("sk-b")}.${cookie.split(".")[1]}`;
    expect(await sessionUserId(new Request("https://vip.example/", { headers: { cookie: forged } }))).toBeUndefined();
  });
});

describe("media links", () => {
  const key = "users/0123456789abcdef0123456789abcdef/uploads/1-abc-ref.png";

  it("rejects keys outside a user's media folders", async () => {
    const { assertKey } = await import("./object-store");
    expect(() => assertKey(key)).not.toThrow();
    expect(() => assertKey("users/0123456789abcdef0123456789abcdef/../x")).toThrow();
    expect(() => assertKey("videos/old.mp4")).toThrow();
  });

  it("signs external links that verify only for the same key", async () => {
    const { externalMediaUrl, verifyMediaSignature } = await import("./object-store");
    const url = new URL(await externalMediaUrl(key, "https://vip.example"));
    expect(url.pathname).toBe(`/api/media/${key}`);
    const exp = url.searchParams.get("exp");
    const sig = url.searchParams.get("sig");
    expect(await verifyMediaSignature(key, exp, sig)).toBe(true);
    expect(await verifyMediaSignature(key.replace("ref", "other"), exp, sig)).toBe(false);
    expect(await verifyMediaSignature(key, "1", sig)).toBe(false);
  });
});
