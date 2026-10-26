import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const key = "users/0123456789abcdef0123456789abcdef/videos/1-abc-clip.mp4";
const ENV_KEYS = ["S3_ENDPOINT", "S3_REGION", "S3_BUCKET", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY",
  "S3_PUBLIC_BASE", "S3_PATH_STYLE", "S3_IMAGE_PROCESS", "R2_ENDPOINT", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET"];

beforeEach(() => {
  vi.resetModules();
  for (const name of ENV_KEYS) delete process.env[name];
  process.env.MOTE_SESSION_SECRET = "test-secret-test-secret-test-secret";
});
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

function useTos(publicBase = "https://media.tangzhi.org") {
  Object.assign(process.env, {
    S3_ENDPOINT: "https://tos-s3-cn-hongkong.volces.com", S3_REGION: "cn-hongkong", S3_BUCKET: "tangzhi-media",
    S3_ACCESS_KEY_ID: "AKTESTEXAMPLE", S3_SECRET_ACCESS_KEY: "secret-example", S3_PUBLIC_BASE: publicBase,
  });
}

describe("object store on Volcengine TOS (S3 compatible)", () => {
  it("writes with virtual-hosted addressing and the real region", async () => {
    useTos();
    const fetchMock = vi.fn<(request: Request) => Promise<Response>>(async () => new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const { putObject, storageName } = await import("./object-store");
    expect(storageName()).toBe("S3");
    await putObject(key, new Uint8Array([1, 2, 3]), "video/mp4");
    const request = fetchMock.mock.calls[0][0];
    expect(new URL(request.url).host).toBe("tangzhi-media.tos-s3-cn-hongkong.volces.com");
    expect(new URL(request.url).pathname).toBe(`/${key}`);
    expect(request.headers.get("authorization")).toContain("/cn-hongkong/s3/aws4_request");
  });

  it("signs playback links on the custom domain", async () => {
    useTos();
    const { signedUrl } = await import("./object-store");
    const url = new URL(await signedUrl(key, 3600, "片段.mp4") as string);
    expect(url.host).toBe("media.tangzhi.org");
    expect(url.pathname).toBe(`/${key}`);
    expect(url.searchParams.get("X-Amz-Credential")).toContain("/cn-hongkong/s3/aws4_request");
    expect(url.searchParams.get("X-Amz-Expires")).toBe("3600");
    expect(url.searchParams.get("response-content-disposition")).toContain("attachment");
  });

  it("falls back to the bucket endpoint when no custom domain is set", async () => {
    useTos("");
    const { signedUrl } = await import("./object-store");
    expect(new URL(await signedUrl(key, 60) as string).host).toBe("tangzhi-media.tos-s3-cn-hongkong.volces.com");
  });

  it("keeps the old R2 configuration working with path-style URLs", async () => {
    Object.assign(process.env, {
      R2_ENDPOINT: "https://acc.r2.cloudflarestorage.com", R2_BUCKET: "tangzhi-media",
      R2_ACCESS_KEY_ID: "id", R2_SECRET_ACCESS_KEY: "secret",
    });
    const { signedUrl, storageName } = await import("./object-store");
    expect(storageName()).toBe("R2");
    const url = new URL(await signedUrl(key, 60) as string);
    expect(url.host).toBe("acc.r2.cloudflarestorage.com");
    expect(url.pathname).toBe(`/tangzhi-media/${key}`);
  });
});

describe("browser media links", () => {
  const image = "users/0123456789abcdef0123456789abcdef/images/1-abc-cat.png";

  it("asks TOS for small thumbnails and video first frames", async () => {
    useTos();
    const { thumbProcess } = await import("./object-store");
    expect(thumbProcess(image, 480)).toBe("image/resize,w_480/format,webp");
    expect(thumbProcess(key, 480)).toBe("video/snapshot,t_0,f_jpg,w_480,m_fast");
    expect(thumbProcess("users/0123456789abcdef0123456789abcdef/uploads/1-a-song.mp3", 480)).toBeUndefined();
  });

  it("falls back to originals (or no video thumbnail) when the store cannot process", async () => {
    Object.assign(process.env, {
      R2_ENDPOINT: "https://acc.r2.cloudflarestorage.com", R2_BUCKET: "tangzhi-media",
      R2_ACCESS_KEY_ID: "id", R2_SECRET_ACCESS_KEY: "secret",
    });
    const { thumbProcess } = await import("./object-store");
    expect(thumbProcess(image, 480)).toBeUndefined();
    expect(thumbProcess(key, 480)).toBeNull();
  });

  it("signs the same URL within a time window so the browser can cache it", async () => {
    useTos();
    vi.useFakeTimers();
    const { browserMediaUrl } = await import("./object-store");
    vi.setSystemTime(new Date("2026-10-26T03:00:00Z"));
    const first = await browserMediaUrl(image, { process: "image/resize,w_480/format,webp" });
    vi.setSystemTime(new Date("2026-10-26T20:00:00Z"));
    const second = await browserMediaUrl(image, { process: "image/resize,w_480/format,webp" });
    expect(second?.url).toBe(first?.url);
    expect(second?.maxAge).toBe(4 * 3600);
    const url = new URL(first!.url);
    expect(url.searchParams.get("x-tos-process")).toBe("image/resize,w_480/format,webp");
    expect(url.searchParams.get("response-cache-control")).toContain("max-age=");
    expect(url.searchParams.get("X-Amz-Date")).toBe("20261026T000000Z");
    vi.setSystemTime(new Date("2026-10-27T01:00:00Z"));
    const nextDay = await browserMediaUrl(image, { process: "image/resize,w_480/format,webp" });
    expect(new URL(nextDay!.url).searchParams.get("X-Amz-Date")).toBe("20261027T000000Z");
  });
});
