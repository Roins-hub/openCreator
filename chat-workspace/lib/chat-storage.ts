import type { AsyncStorageLike } from "@assistant-ui/core/react";
import {
  clearChatHistory,
  exportChatBackup,
  importChatBackup,
  indexedDbStorage,
} from "@/lib/indexed-db-storage";
import { MOTE_MODE, moteHeaders } from "@/lib/mote";

/**
 * 聊天记录存哪里:
 * - 独立部署:浏览器 IndexedDB(原有行为);
 * - 工作台模式:工作台服务器的 /api/chat-store(按中转站账号隔离,换设备也在)。
 * 两种存储的导出文件格式相同,旧站导出的备份可以直接导入工作台。
 */
const STORE_API = "/api/chat-store";
const BACKUP_FORMAT = "sub2image-chat-backup";

type BackupEntry = { key: string; value: string };

/**
 * 一批键最后一次写入的时间(只在工作台模式下有,独立部署的 IndexedDB 不记时间,返回空)。
 * 分批请求,避免地址太长。
 */
export async function chatItemTimes(keys: readonly string[]): Promise<Record<string, string>> {
  if (!MOTE_MODE || !keys.length) return {};
  const times: Record<string, string> = {};
  for (let start = 0; start < keys.length; start += 80) {
    const batch = keys.slice(start, start + 80).map(encodeURIComponent).join(",");
    const data = await call<{ times?: Record<string, string> }>(`${STORE_API}?times=${batch}`).catch(() => ({ times: {} }));
    Object.assign(times, data.times || {});
  }
  return times;
}

async function call<T>(input: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(input, {
    ...init,
    headers: { ...moteHeaders(), ...(init.body ? { "Content-Type": "application/json" } : {}), ...init.headers },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = (data as { error?: string }).error;
    throw new Error(response.status === 401 ? "请先在工作台「设置」里填写 API Key" : message || "聊天记录读写失败");
  }
  return data as T;
}

const moteStorage: AsyncStorageLike = {
  async getItem(key) {
    const data = await call<{ value: string | null }>(`${STORE_API}?key=${encodeURIComponent(key)}`);
    return typeof data.value === "string" ? data.value : null;
  },
  async setItem(key, value) {
    await call(STORE_API, { method: "PUT", body: JSON.stringify({ key, value }) });
  },
  async removeItem(key) {
    await call(`${STORE_API}?key=${encodeURIComponent(key)}`, { method: "DELETE" });
  },
};

export const chatStorage: AsyncStorageLike = MOTE_MODE ? moteStorage : indexedDbStorage;

export async function exportChatHistory(): Promise<string> {
  if (!MOTE_MODE) return exportChatBackup();
  const { entries } = await call<{ entries: BackupEntry[] }>(`${STORE_API}?all=1`);
  return JSON.stringify(
    { format: BACKUP_FORMAT, version: 1, exportedAt: new Date().toISOString(), entries },
    null,
    2,
  );
}

/** 导入备份:替换当前全部聊天记录(与原来的行为一致) */
export async function importChatHistory(raw: string): Promise<void> {
  if (!MOTE_MODE) return importChatBackup(raw);
  let parsed: { format?: unknown; version?: unknown; entries?: unknown };
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("备份文件格式不正确");
  }
  if (parsed.format !== BACKUP_FORMAT || parsed.version !== 1 || !Array.isArray(parsed.entries)) {
    throw new Error("备份文件格式不正确");
  }
  await call(STORE_API, { method: "POST", body: JSON.stringify({ entries: parsed.entries }) });
}

export async function clearAllChatHistory(): Promise<void> {
  if (!MOTE_MODE) return clearChatHistory();
  await call(`${STORE_API}?all=1`, { method: "DELETE" });
}
