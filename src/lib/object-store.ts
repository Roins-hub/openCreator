import { createHmac, timingSafeEqual } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { AwsClient } from "aws4fetch";
import { inside, outDir } from "./paths";
import { sessionSecret } from "./session-secret";

/**
 * 媒体文件存储(S3 兼容的私有桶,只通过临时签名链接访问):
 * - S3_* 环境变量:通用配置,目前用于火山引擎 TOS(只支持「桶名.域名」虚拟主机寻址);
 * - R2_* 环境变量:Cloudflare R2(路径寻址,region=auto),作为旧配置继续兼容;
 * - 都没配置时存本机 out/ 目录,供本地开发使用。
 * 对象 key 形如 users/<用户ID>/videos/<随机名>.mp4。
 */
interface StoreConfig {
  name: string;
  /** 读写对象用的 API 地址生成方式 */
  objectUrl: (key: string) => URL;
  /** 签发给浏览器/中转站的 GET 链接地址(可用绑定在桶上的自定义域名) */
  publicUrl: (key: string) => URL;
  client: AwsClient;
}

const encodeKey = (key: string) => key.split("/").map(encodeURIComponent).join("/");
const trimSlash = (value: string) => value.replace(/\/+$/, "");

let storeCache: StoreConfig | null | undefined;
function store(): StoreConfig | null {
  if (storeCache !== undefined) return storeCache;
  const env = process.env;
  if (env.S3_ENDPOINT && env.S3_BUCKET && env.S3_ACCESS_KEY_ID && env.S3_SECRET_ACCESS_KEY) {
    const endpoint = new URL(trimSlash(env.S3_ENDPOINT));
    const bucket = env.S3_BUCKET;
    const pathStyle = env.S3_PATH_STYLE === "true";
    const objectUrl = (key: string) => pathStyle
      ? new URL(`${endpoint.origin}/${bucket}/${encodeKey(key)}`)
      : new URL(`${endpoint.protocol}//${bucket}.${endpoint.host}/${encodeKey(key)}`);
    const publicBase = env.S3_PUBLIC_BASE ? trimSlash(env.S3_PUBLIC_BASE) : "";
    storeCache = {
      name: "S3",
      objectUrl,
      publicUrl: (key) => publicBase ? new URL(`${publicBase}/${encodeKey(key)}`) : objectUrl(key),
      client: new AwsClient({
        accessKeyId: env.S3_ACCESS_KEY_ID, secretAccessKey: env.S3_SECRET_ACCESS_KEY,
        service: "s3", region: env.S3_REGION || "us-east-1",
      }),
    };
  } else if (env.R2_ENDPOINT && env.R2_ACCESS_KEY_ID && env.R2_SECRET_ACCESS_KEY && env.R2_BUCKET) {
    const endpoint = trimSlash(env.R2_ENDPOINT);
    const objectUrl = (key: string) => new URL(`${endpoint}/${env.R2_BUCKET}/${encodeKey(key)}`);
    storeCache = {
      name: "R2",
      objectUrl,
      publicUrl: objectUrl,
      client: new AwsClient({
        accessKeyId: env.R2_ACCESS_KEY_ID, secretAccessKey: env.R2_SECRET_ACCESS_KEY, service: "s3", region: "auto",
      }),
    };
  } else {
    storeCache = null;
    if (env.NODE_ENV === "production") console.warn("[mote] 未配置云存储，媒体文件将保存在本机磁盘");
  }
  return storeCache;
}

/** 当前使用的存储:S3(TOS 等)/ R2 / local */
export const storageName = () => store()?.name || "local";

export function assertKey(key: string) {
  if (!/^users\/[0-9a-f]{32}\/(videos|uploads)\/[^/]+$/.test(key) || key.includes("..")) {
    throw new Error("非法媒体路径");
  }
  return key;
}

export async function putObject(key: string, body: Uint8Array, contentType: string) {
  assertKey(key);
  const config = store();
  if (!config) {
    const target = inside(outDir, key);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, body);
    return;
  }
  const response = await config.client.fetch(config.objectUrl(key), {
    method: "PUT", body: body as BodyInit,
    headers: { "Content-Type": contentType, "Content-Length": String(body.byteLength) },
  });
  if (!response.ok) throw new Error(`云存储写入失败（${response.status}）`);
}

export async function deleteObject(key: string) {
  assertKey(key);
  const config = store();
  if (!config) {
    await rm(inside(outDir, key), { force: true });
    return;
  }
  const response = await config.client.fetch(config.objectUrl(key), { method: "DELETE" });
  if (!response.ok && response.status !== 404) throw new Error(`云存储删除失败（${response.status}）`);
}

const contentDisposition = (name: string) =>
  `attachment; filename="${name.replace(/[^\x20-\x7e]|"/g, "_")}"; filename*=UTF-8''${encodeURIComponent(name)}`;

/** 云存储临时直链(优先用自定义域名);本地存储时返回 undefined,由 /api/media 自己读文件。 */
export async function signedUrl(key: string, expiresIn: number, downloadName?: string) {
  const config = store();
  if (!config) return undefined;
  const url = config.publicUrl(key);
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
  const direct = await signedUrl(key, expiresIn);
  if (direct) return direct;
  const exp = Math.floor(Date.now() / 1000) + expiresIn;
  return `${origin}/api/media/${encodeKey(key)}?exp=${exp}&sig=${await mediaSignature(key, exp)}`;
}
