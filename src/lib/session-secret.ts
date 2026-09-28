import { randomBytes } from "node:crypto";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { dataDir } from "./paths";

/** 签名用的服务端密钥:优先读 MOTE_SESSION_SECRET,否则在数据目录生成一个并长期保存。 */
let cached: Promise<string> | undefined;

export function sessionSecret() {
  cached ??= load();
  return cached;
}

async function load() {
  if (process.env.MOTE_SESSION_SECRET) return process.env.MOTE_SESSION_SECRET;
  const file = resolve(dataDir, ".session-secret");
  try {
    const value = (await readFile(file, "utf8")).trim();
    if (value.length >= 32) return value;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const value = randomBytes(32).toString("hex");
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, value, { encoding: "utf8", flag: "wx" }).catch(async (error) => {
    // 并发启动时另一个请求已写入,读它的值
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  });
  await chmod(file, 0o600).catch(() => undefined);
  return (await readFile(file, "utf8")).trim();
}
