import type { AsyncStorageLike } from "@assistant-ui/core/react";

/**
 * 工作台模式下聊天记录的浏览器缓存(IndexedDB,按账号分开):
 * 打开页面时每一项「第一次读」先给缓存里的(聊天列表、聊天内容、分组立刻显示出来),
 * 同时在后台向服务端取最新的,不一样就更新缓存并发出 mote-chat-cache-refresh 事件让界面重新读;
 * 之后的读都直接读服务端(改动前的「读 - 改 - 写」拿到的是最新的,几台设备同时用不会互相覆盖)。
 * 写和删先写服务端,成功后同步到缓存。缓存只用来加速显示,出任何错都退回直接读服务端。
 */
const DB_NAME = "mote-chat-cache";
const STORE_NAME = "kv";
export const CHAT_CACHE_REFRESH = "mote-chat-cache-refresh";

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) request.result.createObjectStore(STORE_NAME);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function run<T>(mode: IDBTransactionMode, operation: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
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

type Entry = { value: string | null };

/** account:区分账号的前缀(Key + 中转站地址的哈希),换账号就是另一份缓存 */
export function cachedStorage(server: AsyncStorageLike, account: () => string): AsyncStorageLike & { clear: () => Promise<void> } {
  // 这次打开页面已经读过(或写过)的项:之后都直接读服务端
  const seen = new Set<string>();
  const id = (key: string) => `${account()}|${key}`;
  const put = (key: string, value: string | null) =>
    run("readwrite", (store) => store.put({ value } satisfies Entry, id(key))).catch(() => undefined);
  const drop = (key: string) => run("readwrite", (store) => store.delete(id(key))).catch(() => undefined);

  const revalidate = (key: string, cached: string | null) => {
    void Promise.resolve(server.getItem(key)).then((value) => {
      if (value === cached) return;
      void put(key, value).then(() => window.dispatchEvent(new CustomEvent(CHAT_CACHE_REFRESH, { detail: key })));
    }).catch(() => undefined);
  };

  return {
    async getItem(key) {
      const cacheId = id(key);
      if (!seen.has(cacheId)) {
        seen.add(cacheId);
        const entry = await run<Entry | undefined>("readonly", (store) => store.get(cacheId)).catch(() => undefined);
        if (entry && (typeof entry.value === "string" || entry.value === null)) {
          revalidate(key, entry.value);
          return entry.value;
        }
      }
      const value = await server.getItem(key);
      void put(key, value);
      return value;
    },
    async setItem(key, value) {
      await server.setItem(key, value);
      seen.add(id(key));
      void put(key, value);
    },
    async removeItem(key) {
      await server.removeItem(key);
      seen.add(id(key));
      void drop(key);
    },
    /** 清空这个账号的缓存(清空 / 导入聊天记录后) */
    async clear() {
      const prefix = `${account()}|`;
      seen.clear();
      const keys = await run<IDBValidKey[]>("readonly", (store) => store.getAllKeys()).catch(() => [] as IDBValidKey[]);
      await Promise.all(keys.filter((key) => typeof key === "string" && key.startsWith(prefix))
        .map((key) => run("readwrite", (store) => store.delete(key)).catch(() => undefined)));
    },
  };
}

/** 后台发现服务端和缓存不一样时回调(参数是那一项的键) */
export function onChatCacheRefresh(callback: (key: string) => void) {
  const listener = (event: Event) => callback((event as CustomEvent<string>).detail);
  window.addEventListener(CHAT_CACHE_REFRESH, listener);
  return () => window.removeEventListener(CHAT_CACHE_REFRESH, listener);
}
