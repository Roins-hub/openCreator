import assert from "node:assert/strict";
import test from "node:test";

// 最小的内存版 IndexedDB(只实现 chat-cache 用到的那几个调用)
function fakeIndexedDb() {
  const data = new Map();
  const request = (run) => {
    const req = {};
    queueMicrotask(() => { req.result = run(); req.onsuccess?.(); });
    return req;
  };
  const store = { get: (key) => request(() => data.get(key)), put: (value, key) => request(() => { data.set(key, value); }),
    delete: (key) => request(() => { data.delete(key); }), getAllKeys: () => request(() => [...data.keys()]) };
  const db = { objectStoreNames: { contains: () => true }, close() {},
    transaction: () => { const tx = { objectStore: () => store }; queueMicrotask(() => queueMicrotask(() => tx.oncomplete?.())); return tx; } };
  return { data, open: () => { const req = {}; queueMicrotask(() => { req.result = db; req.onsuccess?.(); }); return req; } };
}

globalThis.indexedDB = fakeIndexedDb();
const events = [];
globalThis.window = { dispatchEvent: (event) => events.push(event.detail), addEventListener() {}, removeEventListener() {} };
globalThis.CustomEvent = class { constructor(type, init) { this.type = type; this.detail = init?.detail; } };
const { cachedStorage } = await import("./chat-cache.ts");
const tick = () => new Promise((resolve) => setTimeout(resolve, 10));

test("first read comes from the cache, then the server is checked in the background", async () => {
  const server = new Map([["sub2chat:threads", "v1"]]);
  const calls = [];
  const backend = {
    getItem: async (key) => { calls.push(key); return server.get(key) ?? null; },
    setItem: async (key, value) => { server.set(key, value); },
    removeItem: async (key) => { server.delete(key); },
  };
  let account = "a";
  // 第一次打开:没缓存,直接读服务端并存进缓存
  assert.equal(await cachedStorage(backend, () => account).getItem("sub2chat:threads"), "v1");
  await tick();
  // 另一台设备改了;再次打开页面:先拿到缓存里的 v1,后台发现是 v2 并发出刷新事件
  server.set("sub2chat:threads", "v2");
  const reopened = cachedStorage(backend, () => account);
  assert.equal(await reopened.getItem("sub2chat:threads"), "v1");
  await tick();
  assert.deepEqual(events, ["sub2chat:threads"]);
  // 之后的读直接读服务端
  assert.equal(await reopened.getItem("sub2chat:threads"), "v2");
  // 换账号是另一份缓存
  account = "b";
  calls.length = 0;
  assert.equal(await cachedStorage(backend, () => account).getItem("sub2chat:threads"), "v2");
  assert.deepEqual(calls, ["sub2chat:threads"]);
});
