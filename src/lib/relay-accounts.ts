import { Pool } from "pg";

/**
 * 读取中转站(new-api)数据库,把 API Key 对应到中转站账号。
 * 只用到 tokens / users 的少数几列,数据库账号应只授予这些列的只读权限。
 * 没配置 RELAY_DB_URL 时返回 null,工作台退回「按 Key 隔离」的旧方式。
 */
export interface RelayAccounts {
  /** 有效 Key(未删除、已启用、未过期,且账号未封禁)所属的账号 ID;无效返回 null */
  accountOfKey(key: string): Promise<string | null>;
  /** 该账号名下所有 Key(包括已删除的),用于把旧的按 Key 存放的数据合并过来 */
  keysOfAccount(accountId: string): Promise<string[]>;
}

/** new-api 存储的 Key 不带 sk- 前缀 */
export const storedKey = (apiKey: string) => apiKey.trim().replace(/^sk-/, "");

let cached: RelayAccounts | null | undefined;

export function relayAccounts(): RelayAccounts | null {
  if (cached !== undefined) return cached;
  const url = process.env.RELAY_DB_URL;
  if (!url) return (cached = null);
  const pool = new Pool({ connectionString: url, max: 4, idleTimeoutMillis: 30_000, connectionTimeoutMillis: 5_000 });
  // 数据库重启等情况下的空闲连接错误不应让进程崩溃,下次查询会重新连接
  pool.on("error", (error) => console.warn("[mote] 中转站数据库连接异常:", error.message));
  cached = {
    async accountOfKey(key) {
      const result = await pool.query<{ user_id: string }>(
        `select t.user_id::text as user_id
           from tokens t join users u on u.id = t.user_id
          where t.key = $1 and t.deleted_at is null and t.status = 1
            and (t.expired_time = -1 or t.expired_time > extract(epoch from now()))
            and u.deleted_at is null and u.status = 1
          limit 1`,
        [storedKey(key)],
      );
      return result.rows[0]?.user_id ?? null;
    },
    async keysOfAccount(accountId) {
      const result = await pool.query<{ key: string }>("select key from tokens where user_id = $1", [accountId]);
      return result.rows.map((row) => row.key);
    },
  };
  return cached;
}
