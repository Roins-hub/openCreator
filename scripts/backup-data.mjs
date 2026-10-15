#!/usr/bin/env node
/**
 * 文字数据(对话、聊天记录、资产索引、收藏、分组、提示词)每日备份到对象存储。
 *
 *   node scripts/backup-data.mjs                 打包 $MOTE_STORAGE_ROOT/data,上传到 backups/,并校验大小
 *   node scripts/backup-data.mjs --lifecycle [天数]   设置存储桶的过期规则:媒体 users/ 和备份 backups/ 都在
 *                                                    [天数](默认 60)后删除;桶里其他规则原样保留
 *   node scripts/backup-data.mjs --list          列出已有备份
 *   node scripts/backup-data.mjs --download <key> <file>   下载一份备份(恢复时解压到新目录核对后再替换)
 *
 * 读取与工作台相同的存储配置:S3_ENDPOINT / S3_BUCKET / S3_REGION / S3_ACCESS_KEY_ID / S3_SECRET_ACCESS_KEY
 * (可选 S3_PATH_STYLE=true)。备份放在 backups/ 下,和 users/ 下的媒体各用一条过期规则。
 */
import { createHash } from "node:crypto";
import { readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { AwsClient } from "aws4fetch";

const PREFIX = "backups/";
const DEFAULT_RETENTION_DAYS = 60;
// 工作台管理的两条过期规则:规则 ID → 前缀
const MANAGED_RULES = { "expire-media": "users/", "expire-backups": PREFIX };

const env = process.env;
for (const name of ["S3_ENDPOINT", "S3_BUCKET", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY"]) {
  if (!env[name]) throw new Error(`缺少环境变量 ${name}`);
}
const endpoint = new URL(env.S3_ENDPOINT.replace(/\/+$/, ""));
const bucketUrl = env.S3_PATH_STYLE === "true"
  ? `${endpoint.origin}/${env.S3_BUCKET}`
  : `${endpoint.protocol}//${env.S3_BUCKET}.${endpoint.host}`;
const client = new AwsClient({
  accessKeyId: env.S3_ACCESS_KEY_ID, secretAccessKey: env.S3_SECRET_ACCESS_KEY,
  service: "s3", region: env.S3_REGION || "us-east-1",
});

async function request(path, init = {}) {
  const response = await client.fetch(`${bucketUrl}${path}`, init);
  if (!response.ok && response.status !== 404) {
    throw new Error(`${init.method || "GET"} ${path} 返回 ${response.status}：${(await response.text()).slice(0, 300)}`);
  }
  return response;
}

const stamp = () => new Date().toISOString().replace(/[-:]/g, "").replace(/\..*$/, "").replace("T", "-");

async function backup() {
  const root = env.MOTE_STORAGE_ROOT || process.cwd();
  const archive = join(tmpdir(), `mote-data-${stamp()}.tgz`);
  const tar = spawnSync("tar", ["-czf", archive, "-C", root, "data"], { stdio: "inherit" });
  if (tar.status !== 0) throw new Error(`打包失败(tar 退出码 ${tar.status})`);
  try {
    const body = readFileSync(archive);
    const key = `${PREFIX}mote-data-${stamp()}.tgz`;
    await request(`/${key}`, {
      method: "PUT", body,
      headers: { "Content-Type": "application/gzip", "Content-Length": String(body.byteLength) },
    });
    const head = await request(`/${key}`, { method: "HEAD" });
    const size = Number(head.headers.get("content-length"));
    if (head.status !== 200 || size !== body.byteLength) throw new Error(`上传校验失败:本地 ${body.byteLength} 字节,云端 ${size}`);
    console.log(`已备份 ${key}(${body.byteLength} 字节)`);
  } finally {
    rmSync(archive, { force: true });
  }
}

/** 把媒体(users/)和备份(backups/)的过期天数设成 days;桶里其他规则原样保留 */
async function setLifecycle(days) {
  if (!Number.isInteger(days) || days < 1 || days > 3650) throw new Error("天数应为 1~3650 的整数");
  const current = await request("/?lifecycle");
  const xml = current.status === 404 ? "" : await current.text();
  const managed = new Set(Object.keys(MANAGED_RULES));
  // TOS 读回的规则会多带一个空的 <Filter></Filter>,原样写回会被当成「整个桶」和 users/ 重叠,去掉它
  const others = [...xml.matchAll(/<Rule>[\s\S]*?<\/Rule>/g)]
    .map((match) => match[0].replace(/<Filter\s*\/>|<Filter>\s*<\/Filter>/g, ""))
    .filter((rule) => !managed.has(/<ID>(.*?)<\/ID>/.exec(rule)?.[1] || ""));
  // 和已有规则一样用 <Prefix> 写法:两种写法混用时 TOS 会把 <Filter> 那条当成整个桶
  const rules = [
    ...others,
    ...Object.entries(MANAGED_RULES).map(([id, prefix]) =>
      `<Rule><ID>${id}</ID><Prefix>${prefix}</Prefix><Status>Enabled</Status><Expiration><Days>${days}</Days></Expiration>`
      + "<AbortIncompleteMultipartUpload><DaysAfterInitiation>7</DaysAfterInitiation></AbortIncompleteMultipartUpload></Rule>"),
  ];
  const body = `<?xml version="1.0" encoding="UTF-8"?><LifecycleConfiguration>${rules.join("")}</LifecycleConfiguration>`;
  await request("/?lifecycle", {
    method: "PUT", body,
    headers: { "Content-Type": "application/xml", "Content-MD5": createHash("md5").update(body).digest("base64") },
  });
  const check = await (await request("/?lifecycle")).text();
  for (const [id, prefix] of Object.entries(MANAGED_RULES)) {
    const rule = [...check.matchAll(/<Rule>[\s\S]*?<\/Rule>/g)].map((m) => m[0]).find((item) => item.includes(`<ID>${id}</ID>`));
    if (!rule?.includes(`<Days>${days}</Days>`)) throw new Error(`写入后没有读到规则 ${id}`);
    console.log(`规则 ${id}:${prefix} 下的文件 ${days} 天后删除`);
  }
  if (others.length) console.log(`另有 ${others.length} 条规则原样保留`);
}

async function list() {
  const response = await request(`/?list-type=2&prefix=${encodeURIComponent(PREFIX)}`);
  const xml = await response.text();
  const items = [...xml.matchAll(/<Contents>[\s\S]*?<Key>(.*?)<\/Key>[\s\S]*?<LastModified>(.*?)<\/LastModified>[\s\S]*?<Size>(\d+)<\/Size>[\s\S]*?<\/Contents>/g)];
  for (const [, key, modified, size] of items) console.log(`${modified}  ${size.padStart(10)}  ${key}`);
  console.log(`共 ${items.length} 份备份`);
}

async function download(key, file) {
  if (!key?.startsWith(PREFIX) || !file) throw new Error("用法:--download backups/<文件名> <保存到的本地文件>");
  const response = await request(`/${key}`);
  if (response.status !== 200) throw new Error(`备份不存在:${key}`);
  writeFileSync(file, new Uint8Array(await response.arrayBuffer()));
  console.log(`已下载到 ${file}(${statSync(file).size} 字节)。先解压到新目录核对:tar -xzf ${file} -C <新目录>`);
}

const [command, ...args] = process.argv.slice(2);
const tasks = {
  "--lifecycle": () => setLifecycle(args[0] ? Number(args[0]) : DEFAULT_RETENTION_DAYS),
  "--list": list,
  "--download": () => download(args[0], args[1]),
};
(tasks[command] || backup)().catch((error) => {
  console.error(`备份失败:${error.message}`);
  process.exit(1);
});
