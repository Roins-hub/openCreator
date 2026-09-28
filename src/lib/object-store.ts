import { createHmac, timingSafeEqual } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { AwsClient } from "aws4fetch";
import { inside, outDir } from "./paths";
import { sessionSecret } from "./session-secret";

/**
 * 媒体文件存储。配置了 R2_* 环境变量时存 Cloudflare R2(私有桶,只通过临时签名链接访问);
 * 否则存本机 out/ 目录,供本地开发使用。对象 key 形如 users/<用户ID>/videos/<随机名>.mp4。
 */
interface R2Config { endpoint: string; bucket: string; client: AwsClient }

let r2Cache: R2Config | null | undefined;
function r2(): R2Config | null {
  if (r2Cache !== undefined) return r2Cache;
  const { R2_ENDPOINT, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET } = process.env;
  r2Cache = R2_ENDPOINT && R2_ACCESS_KEY_ID && R2_SECRET_ACCESS_KEY && R2_BUCKET ? {
    endpoint: R2_ENDPOINT.replace(/\/+$/, ""),
    bucket: R2_BUCKET,
    client: new AwsClient({
      accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY, service: "s3", region: "auto",
    }),
  } : null;
  if (!r2Cache && process.env.NODE_ENV === "production") {
    console.warn("[mote] R2 未配置，媒体文件将保存在本机磁盘");
  }
  return r2Cache;
}

export const usingR2 = () => Boolean(r2());

const encodeKey = (key: string) => key.split("/").map(encodeURIComponent).join("/");
const objectUrl = (config: R2Config, key: string) => new URL(`${config.endpoint}/${config.bucket}/${encodeKey(key)}`);

export function assertKey(key: string) {
  if (!/^users\/[0-9a-f]{32}\/(videos|uploads)\/[^/]+$/.test(key) || key.includes("..")) {
    throw new Error("非法媒体路径");
  }
  return key;
}

export async function putObject(key: string, body: Uint8Array, contentType: string) {
  assertKey(key);
  const config = r2();
  if (!config) {
    const target = inside(outDir, key);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, body);
    return;
  }
  const response = await config.client.fetch(objectUrl(config, key), {
    method: "PUT", body: body as BodyInit,
    headers: { "Content-Type": contentType, "Content-Length": String(body.byteLength) },
  });
  if (!response.ok) throw new Error(`云存储写入失败（${response.status}）`);
}

export async function deleteObject(key: string) {
  assertKey(key);
  const config = r2();
  if (!config) {
    await rm(inside(outDir, key), { force: true });
    return;
  }
  const response = await config.client.fetch(objectUrl(config, key), { method: "DELETE" });
  if (!response.ok && response.status !== 404) throw new Error(`云存储删除失败（${response.status}）`);
}

const contentDisposition = (name: string) =>
  `attachment; filename="${name.replace(/[^\x20-\x7e]|"/g, "_")}"; filename*=UTF-8''${encodeURIComponent(name)}`;

/** R2 临时直链;本地存储时返回 undefined,由 /api/media 自己读文件。 */
export async function r2SignedUrl(key: string, expiresIn: number, downloadName?: string) {
  const config = r2();
  if (!config) return undefined;
  const url = objectUrl(config, key);
  url.searchParams.set("X-Amz-Expires", String(expiresIn));
  if (downloadName) url.searchParams.set("response-content-disposition", contentDisposition(downloadName));
  const signed = await config.client.sign(new Request(url, { method: "GET" }), { aws: { signQuery: true } });
  return signed.url;
}

// ---- 本地存储时给外部(中转站)用的签名链接:/api/media/<key>?exp=&sig=
const mediaSignature = async (key: string, exp: number) =>
  createHmac("sha256", await sessionSecret()).update(`media:${key}:${exp}`).digest("hex");

export async function verifyMediaSignature(key: string, exp: string | null, sig: string | null) {
  if (!exp || !sig || !/^\d+$/.test(exp) || Number(exp) * 1000 < Date.now()) return false;
  const expected = Buffer.from(await mediaSignature(key, Number(exp)));
  const actual = Buffer.from(sig);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

/** 给中转站拉取参考素材用的公网链接(有效期内无需登录)。 */
export async function externalMediaUrl(key: string, origin: string, expiresIn = 24 * 3600) {
  assertKey(key);
  const direct = await r2SignedUrl(key, expiresIn);
  if (direct) return direct;
  const exp = Math.floor(Date.now() / 1000) + expiresIn;
  return `${origin}/api/media/${encodeKey(key)}?exp=${exp}&sig=${await mediaSignature(key, exp)}`;
}
