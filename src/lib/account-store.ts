import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { inside } from "./paths";
import { readJson, writeJsonAtomic } from "./json-store";
import { sessionSecret } from "./session-secret";
import { userDir } from "./identity";

/**
 * 站内登录的账号:中转站账号 ID、用户名,以及为它自动创建的令牌(加密保存,浏览器拿不到)。
 * 存在 data/users/<账号空间>/account.json,只在服务端读写。
 */
export interface AccountRecord {
  accountId: string;
  username: string;
  tokenId: number;
  /** AES-256-GCM 加密后的令牌明文 */
  keyEnc: string;
  updatedAt: string;
}

const file = (userId: string) => inside(userDir(userId), "account.json");

async function cipherKey() {
  return createHash("sha256").update(`mote-account-key:${await sessionSecret()}`).digest();
}

export async function encryptSecret(plain: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", await cipherKey(), iv);
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), data]).toString("base64");
}

export async function decryptSecret(payload: string) {
  const raw = Buffer.from(payload, "base64");
  const decipher = createDecipheriv("aes-256-gcm", await cipherKey(), raw.subarray(0, 12));
  decipher.setAuthTag(raw.subarray(12, 28));
  return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString("utf8");
}

export function readAccount(userId: string) {
  return readJson<AccountRecord | null>(file(userId), null);
}

export async function saveAccount(userId: string, record: Omit<AccountRecord, "keyEnc" | "updatedAt"> & { key: string }) {
  const { key, ...rest } = record;
  await writeJsonAtomic(file(userId), { ...rest, keyEnc: await encryptSecret(key), updatedAt: new Date().toISOString() });
}
