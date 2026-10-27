import { createHmac, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { AwsClient } from "aws4fetch";
import { inside, outDir } from "./paths";
import { sessionSecret } from "./session-secret";

/**
 * 媒体文件存储(S3 兼容的私有桶,只通过临时签名链接访问):
 * - S3_* 环境变量:通用配置,目前用于火山引擎 TOS(只支持「桶名.域名」虚拟主机寻址);
 * - R2_* 环境变量:Cloudflare R2(路径寻址,region=auto),作为旧配置继续兼容;
 * - 都没配置时存本机 out/ 目录,供本地开发使用。
 * 对象 key 形如 users/<用户ID>/videos/<随机名>.mp4(生成的图片在 images/,上传的素材在 uploads/)。
 */
interface StoreConfig {
  name: string;
  /** 读写对象用的 API 地址生成方式 */
  objectUrl: (key: string) => URL;
  /** 签发给浏览器/中转站的 GET 链接地址(可用绑定在桶上的自定义域名) */
  publicUrl: (key: string) => URL;
  client: AwsClient;
  /** 支持 x-tos-process 现场出缩略图 / 视频截帧(火山 TOS) */
  processing: boolean;
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
      processing: env.S3_IMAGE_PROCESS ? env.S3_IMAGE_PROCESS === "tos" : /(^|\.)volces\.com$|(^|\.)bytepluses\.com$/.test(endpoint.hostname),
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
      processing: false,
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
  if (!/^users\/[0-9a-f]{32}\/(videos|images|uploads)\/[^/]+$/.test(key) || key.includes("..")) {
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

/**
 * 浏览器直传用的限时上传地址(只有云存储时才有)。浏览器离对象存储近,不再经过本站服务器中转,
 * 上传快很多;桶上要配好允许本站域名 PUT 的跨域规则(见 scripts/setup-storage-cors.mjs)。
 */
export async function signedUploadUrl(key: string, expiresIn = 900) {
  assertKey(key);
  const config = store();
  if (!config) return undefined;
  const url = config.objectUrl(key);
  url.searchParams.set("X-Amz-Expires", String(expiresIn));
  const signed = await config.client.sign(new Request(url, { method: "PUT" }), { aws: { signQuery: true } });
  return signed.url;
}

/** 对象的大小;不存在时返回 undefined */
export async function objectSize(key: string) {
  assertKey(key);
  const config = store();
  if (!config) return stat(inside(outDir, key)).then((info) => info.size, () => undefined);
  const response = await config.client.fetch(config.objectUrl(key), { method: "HEAD" });
  if (response.status === 404) return undefined;
  if (!response.ok) throw new Error(`云存储读取失败（${response.status}）`);
  return Number(response.headers.get("content-length") || 0);
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

// ---- 预先生成并保存的缩略图 / 大图(见 media-derived.ts):放在 users/<用户ID>/derived/<规格>/ 下 ----
export type DerivedVariant = "w480" | "w1080" | "view";
const DERIVED_KEY = /^users\/[0-9a-f]{32}\/derived\/(w480|w1080|view)\/(videos|images|uploads)\/[^/]+$/;

/** 原文件对应的生成件路径 */
export function derivedKey(key: string, variant: DerivedVariant) {
  assertKey(key);
  const [, userId, ...rest] = key.split("/");
  return `users/${userId}/derived/${variant}/${rest.join("/")}`;
}

/** 当前存储能不能现场处理图片 / 视频截帧(火山 TOS) */
export const mediaProcessing = () => Boolean(store()?.processing);

/** 让云存储按 process 处理原文件,取回处理结果(服务端生成缩略图用) */
export async function fetchProcessed(key: string, process: string) {
  assertKey(key);
  const config = store();
  if (!config?.processing) throw new Error("当前存储不支持图片处理");
  const url = config.objectUrl(key);
  url.searchParams.set("x-tos-process", process);
  const response = await config.client.fetch(url, { method: "GET" });
  if (!response.ok) throw new Error(`云存储处理失败（${response.status}）`);
  return { body: new Uint8Array(await response.arrayBuffer()), contentType: response.headers.get("content-type") || "application/octet-stream" };
}

export async function putDerived(key: string, body: Uint8Array, contentType: string) {
  if (!DERIVED_KEY.test(key)) throw new Error("非法媒体路径");
  const config = store();
  if (!config) return;
  const response = await config.client.fetch(config.objectUrl(key), {
    method: "PUT", body: body as BodyInit,
    headers: { "Content-Type": contentType, "Content-Length": String(body.byteLength) },
  });
  if (!response.ok) throw new Error(`云存储写入失败（${response.status}）`);
}

export async function deleteDerived(key: string) {
  if (!DERIVED_KEY.test(key)) throw new Error("非法媒体路径");
  const config = store();
  if (!config) return;
  const response = await config.client.fetch(config.objectUrl(key), { method: "DELETE" });
  if (!response.ok && response.status !== 404) throw new Error(`云存储删除失败（${response.status}）`);
}

/** 读取对象内容(生图时把参考图转交给中转站) */
export async function getObject(key: string) {
  assertKey(key);
  const config = store();
  if (!config) return new Uint8Array(await readFile(inside(outDir, key)));
  const response = await config.client.fetch(config.objectUrl(key), { method: "GET" });
  if (!response.ok) throw new Error(`云存储读取失败（${response.status}）`);
  return new Uint8Array(await response.arrayBuffer());
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

/**
 * 缩略图的处理参数:图片缩到 width 宽并转 WebP,视频截第一帧 JPG。
 * 返回 undefined 表示直接用原文件(本来就不是图/视频,或存储不支持处理的图片),
 * 返回 null 表示没有缩略图可给(存储不支持处理的视频)。
 */
export function thumbProcess(key: string, width: number): string | undefined | null {
  const ext = key.slice(key.lastIndexOf(".") + 1).toLowerCase();
  const processing = Boolean(store()?.processing);
  if (["png", "jpg", "jpeg", "webp", "bmp"].includes(ext)) {
    return processing ? `image/resize,w_${width}/format,webp` : undefined;
  }
  if (["mp4", "mov", "webm", "m4v"].includes(ext)) {
    return processing ? `video/snapshot,t_0,f_jpg,w_${width},m_fast` : null;
  }
  return undefined;
}

// 浏览器用的链接按固定时间段签名:同一段时间里同一个文件的链接一模一样,浏览器能直接用缓存;
// 链接有效期是时间段的 3 倍,段末签出的链接也还能用很久
const CACHE_WINDOW = 24 * 3600;

/**
 * 给浏览器显示 / 下载用的云存储直链(本地存储时返回 undefined)。
 * maxAge:这个链接还会被继续签发多久(秒),/api/media 的跳转按它缓存。
 */
export async function browserMediaUrl(key: string, options: { download?: string; process?: string } = {}) {
  const config = store();
  if (!config) return undefined;
  const now = Math.floor(Date.now() / 1000);
  const start = now - (now % CACHE_WINDOW);
  const url = config.publicUrl(key);
  url.searchParams.set("X-Amz-Expires", String(CACHE_WINDOW * 3));
  url.searchParams.set("response-cache-control", `private, max-age=${CACHE_WINDOW}`);
  if (options.download) url.searchParams.set("response-content-disposition", contentDisposition(options.download));
  if (options.process) url.searchParams.set("x-tos-process", options.process);
  const datetime = new Date(start * 1000).toISOString().replace(/[:-]|\.\d{3}/g, "");
  const signed = await config.client.sign(new Request(url, { method: "GET" }), { aws: { signQuery: true, datetime } });
  return { url: signed.url, maxAge: Math.max(60, start + CACHE_WINDOW - now) };
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
