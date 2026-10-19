#!/usr/bin/env node
/**
 * 给媒体桶配置跨域规则,让浏览器能把素材直接 PUT 到对象存储(见 /api/uploads/direct)。
 * 只允许本站域名(MOTE_PUBLIC_URL,可用 CORS_ORIGINS 追加,逗号分隔),只放行 PUT / GET / HEAD。
 * 用法(在服务器上,带上存储的环境变量):
 *   set -a; . /etc/mote/storage.env; set +a; MOTE_PUBLIC_URL=https://vip.tangzhi.org node scripts/setup-storage-cors.mjs
 * 加 --show 只查看当前规则,不修改。
 */
import { createHash } from "node:crypto";
import { AwsClient } from "aws4fetch";

const env = process.env;
if (!env.S3_ENDPOINT || !env.S3_BUCKET || !env.S3_ACCESS_KEY_ID || !env.S3_SECRET_ACCESS_KEY) {
  console.error("缺少 S3_ENDPOINT / S3_BUCKET / S3_ACCESS_KEY_ID / S3_SECRET_ACCESS_KEY");
  process.exit(1);
}
const endpoint = new URL(env.S3_ENDPOINT.replace(/\/+$/, ""));
const url = env.S3_PATH_STYLE === "true"
  ? `${endpoint.origin}/${env.S3_BUCKET}?cors`
  : `${endpoint.protocol}//${env.S3_BUCKET}.${endpoint.host}/?cors`;
const client = new AwsClient({
  accessKeyId: env.S3_ACCESS_KEY_ID, secretAccessKey: env.S3_SECRET_ACCESS_KEY,
  service: "s3", region: env.S3_REGION || "us-east-1",
});

if (process.argv.includes("--show")) {
  const response = await client.fetch(url);
  console.log(response.status, await response.text());
  process.exit(0);
}

const origins = [env.MOTE_PUBLIC_URL, ...(env.CORS_ORIGINS || "").split(",")]
  .map((item) => item?.trim().replace(/\/+$/, ""))
  .filter(Boolean);
if (!origins.length) {
  console.error("请用 MOTE_PUBLIC_URL 指定本站地址,如 https://vip.tangzhi.org");
  process.exit(1);
}
const xml = `<?xml version="1.0" encoding="UTF-8"?>
<CORSConfiguration>
  <CORSRule>
${origins.map((origin) => `    <AllowedOrigin>${origin}</AllowedOrigin>`).join("\n")}
    <AllowedMethod>PUT</AllowedMethod>
    <AllowedMethod>GET</AllowedMethod>
    <AllowedMethod>HEAD</AllowedMethod>
    <AllowedHeader>*</AllowedHeader>
    <ExposeHeader>ETag</ExposeHeader>
    <MaxAgeSeconds>3600</MaxAgeSeconds>
  </CORSRule>
</CORSConfiguration>`;
const response = await client.fetch(url, {
  method: "PUT", body: xml,
  headers: { "Content-Type": "application/xml", "Content-MD5": createHash("md5").update(xml).digest("base64") },
});
console.log(response.status, response.ok ? `已允许 ${origins.join(", ")} 直传` : await response.text());
process.exit(response.ok ? 0 : 1);
