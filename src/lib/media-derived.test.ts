import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const owner = "0123456789abcdef0123456789abcdef";
const image = `users/${owner}/images/1-abc-cat.png`;
const video = `users/${owner}/videos/1-abc-clip.mp4`;

let root: string;
beforeAll(async () => {
  root = await mkdtemp(join(process.env.TMP || tmpdir(), "mote-derived-"));
});
afterAll(async () => { await rm(root, { recursive: true, force: true }); });
beforeEach(() => {
  vi.resetModules();
  vi.unstubAllGlobals();
  process.env.MOTE_STORAGE_ROOT = root;
  process.env.MOTE_SESSION_SECRET = "test-secret-test-secret-test-secret";
  Object.assign(process.env, {
    S3_ENDPOINT: "https://tos-s3-cn-hongkong.volces.com", S3_REGION: "cn-hongkong", S3_BUCKET: "tangzhi-media",
    S3_ACCESS_KEY_ID: "AKTESTEXAMPLE", S3_SECRET_ACCESS_KEY: "secret-example", S3_PUBLIC_BASE: "https://media.tangzhi.org",
  });
});

describe("derived thumbnails and view images", () => {
  it("knows which process each variant needs", async () => {
    const { variantProcess, variantForWidth } = await import("./media-derived");
    expect(variantProcess(image, "w480")).toBe("image/resize,w_480/format,webp");
    expect(variantProcess(image, "view")).toBe("image/format,webp/quality,q_90");
    expect(variantProcess(video, "w480")).toBe("video/snapshot,t_0,f_jpg,w_480,m_fast");
    expect(variantProcess(video, "view")).toBeUndefined();
    expect([240, 480, 720, 1080, 2000].map(variantForWidth)).toEqual(["w480", "w480", "w1080", "w1080", "w1080"]);
  });

  it("generates a variant once in the background and remembers it", async () => {
    const calls: { method: string; url: string }[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: Request) => {
      calls.push({ method: input.method, url: input.url });
      return input.method === "GET"
        ? new Response(new Uint8Array([1, 2, 3]), { headers: { "content-type": "image/webp" } })
        : new Response(null, { status: 200 });
    }));
    const { ensureDerived, hasDerived } = await import("./media-derived");
    expect(await hasDerived(image, "w480")).toBe(false);
    ensureDerived(image, "w480");
    ensureDerived(image, "w480");
    await vi.waitFor(async () => expect(await hasDerived(image, "w480")).toBe(true));
    const get = calls.filter((call) => call.method === "GET");
    const put = calls.filter((call) => call.method === "PUT");
    expect(get).toHaveLength(1);
    expect(new URL(get[0].url).searchParams.get("x-tos-process")).toBe("image/resize,w_480/format,webp");
    expect(put).toHaveLength(1);
    expect(new URL(put[0].url).pathname).toBe(`/users/${owner}/derived/w480/images/1-abc-cat.png`);
  });

  it("does nothing when the store cannot process images", async () => {
    for (const name of ["S3_ENDPOINT", "S3_BUCKET", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY"]) delete process.env[name];
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { prepareDerived, variantProcess } = await import("./media-derived");
    prepareDerived(image, "image");
    expect(variantProcess(image, "view")).toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
