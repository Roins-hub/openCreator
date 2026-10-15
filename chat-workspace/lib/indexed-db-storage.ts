import type { AsyncStorageLike } from "@assistant-ui/core/react";

const DB_NAME = "sub2image-chat";
const STORE_NAME = "assistant-ui";
const DB_VERSION = 1;

type BackupEntry = { key: string; value: string };

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function runRequest<T>(
  mode: IDBTransactionMode,
  operation: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, mode);
    const request = operation(transaction.objectStore(STORE_NAME));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    transaction.oncomplete = () => db.close();
    transaction.onerror = () => reject(transaction.error);
  });
}

export const indexedDbStorage: AsyncStorageLike = {
  async getItem(key) {
    const value = await runRequest("readonly", (store) => store.get(key));
    return typeof value === "string" ? value : null;
  },
  async setItem(key, value) {
    await runRequest("readwrite", (store) => store.put(value, key));
  },
  async removeItem(key) {
    await runRequest("readwrite", (store) => store.delete(key));
  },
};

export async function exportChatBackup(): Promise<string> {
  const db = await openDatabase();
  const entries = await new Promise<BackupEntry[]>((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, "readonly");
    const store = transaction.objectStore(STORE_NAME);
    const keysRequest = store.getAllKeys();
    const valuesRequest = store.getAll();
    transaction.oncomplete = () => {
      const entries = keysRequest.result.flatMap((key, index) => {
        const value = valuesRequest.result[index];
        return typeof key === "string" && typeof value === "string" ? [{ key, value }] : [];
      });
      resolve(entries);
      db.close();
    };
    transaction.onerror = () => reject(transaction.error);
  });

  return JSON.stringify(
    {
      format: "sub2image-chat-backup",
      version: 1,
      exportedAt: new Date().toISOString(),
      entries,
    },
    null,
    2,
  );
}

export async function importChatBackup(raw: string): Promise<void> {
  const parsed = JSON.parse(raw) as {
    format?: unknown;
    version?: unknown;
    entries?: unknown;
  };
  if (
    parsed.format !== "sub2image-chat-backup" ||
    parsed.version !== 1 ||
    !Array.isArray(parsed.entries)
  ) {
    throw new Error("备份文件格式不正确");
  }

  const entries = parsed.entries.filter(
    (entry): entry is BackupEntry =>
      typeof entry === "object" &&
      entry !== null &&
      typeof (entry as BackupEntry).key === "string" &&
      typeof (entry as BackupEntry).value === "string" &&
      (entry as BackupEntry).key.startsWith("sub2chat:"),
  );
  if (entries.length !== parsed.entries.length) {
    throw new Error("备份文件包含无效数据");
  }

  const db = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, "readwrite");
    const store = transaction.objectStore(STORE_NAME);
    store.clear();
    entries.forEach(({ key, value }) => store.put(value, key));
    transaction.oncomplete = () => {
      db.close();
      resolve();
    };
    transaction.onerror = () => reject(transaction.error);
  });
}

export async function clearChatHistory(): Promise<void> {
  const db = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, "readwrite");
    transaction.objectStore(STORE_NAME).clear();
    transaction.oncomplete = () => {
      db.close();
      resolve();
    };
    transaction.onerror = () => reject(transaction.error);
  });
}
