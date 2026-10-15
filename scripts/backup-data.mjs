#!/usr/bin/env node
/**
 * 文字数据(对话、聊天记录、资产索引、收藏、分组、提示词)每日备份到对象存储。
 *
 *   node scripts/backup-data.mjs                 打包 $MOTE_STORAGE_ROOT/data,上传到 backups/,并校验大小
 *   node scripts/backup-data.mjs --lifecycle     确认存储桶有「backups/ 30 天后删除」的规则(保留已有规则)
 *   node scripts/backup-data.mjs --list          列出已有备份
 *   node scripts/backup-data.mjs --download <key> <file>   下载一份备份(恢复时解压到新目录核对后再替换)
 *
 * 读取与工作台相同的存储配置:S3_ENDPOINT / S3_BUCKET / S3_REGION / S3_ACCESS_KEY_ID / S3_SECRET_ACCESS_KEY
 * (可选 S3_PATH_STYLE=true)。备份放在 backups/ 下,不受 users/ 的 30 天媒体过期规则影响。
 */
import { createHash } from "node:crypto";
import { readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { AwsClient } from "aws4fetch";

const PREFIX = "backups/";
const RETENTION_DAYS = 30;
const RULE_ID = "expire-backups";

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

/** 在已有生命周期规则里补上 backups/ 的过期规则;已有就不动 */
async function ensureLifecycle() {
  const current = await request("/?lifecycle");
  const xml = current.status === 404 ? "" : await current.text();
  if (xml.includes(`<ID>${RULE_ID}</ID>`)) {
    console.log(`生命周期规则 ${RULE_ID} 已存在`);
    return;
  }
  // TOS 读回的规则会多带一个空的 <Filter></Filter>,原样写回会被当成「整个桶」和 users/ 重叠,去掉它
  const rules = [...xml.matchAll(/<Rule>[\s\S]*?<\/Rule>/g)]
    .map((match) => match[0].replace(/<Filter\s*\/>|<Filter>\s*<\/Filter>/g, ""));
  rules.push(`<Rule><ID>${RULE_ID}</ID><Filter><Prefix>${PREFIX}</Prefix></Filter><Status>Enabled</Status><Expiration><Days>${RETENTION_DAYS}</Days></Expiration></Rule>`);
  const body = `<?xml version="1.0" encoding="UTF-8"?><LifecycleConfiguration>${rules.join("")}</LifecycleConfiguration>`;
  await request("/?lifecycle", {
    method: "PUT", body,
    headers: { "Content-Type": "application/xml", "Content-MD5": createHash("md5").update(body).digest("base64") },
  });
  const check = await (await request("/?lifecycle")).text();
  if (!check.includes(`<ID>${RULE_ID}</ID>`)) throw new Error("写入生命周期规则后没有读到");
  console.log(`已添加规则 ${RULE_ID}:${PREFIX} 下的文件 ${RETENTION_DAYS} 天后删除;原有 ${rules.length - 1} 条规则保留`);
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
const tasks = { "--lifecycle": ensureLifecycle, "--list": list, "--download": () => download(args[0], args[1]) };
(tasks[command] || backup)().catch((error) => {
  console.error(`备份失败:${error.message}`);
  process.exit(1);
});
