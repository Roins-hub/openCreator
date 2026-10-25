"use client";

import { useEffect, useMemo, useRef } from "react";
import {
  RuntimeAdapterProvider,
  createLocalStorageAdapter,
  createSimpleTitleAdapter,
} from "@assistant-ui/core/react";
import { useAui } from "@assistant-ui/react";
import type {
  GenericThreadHistoryAdapter,
  MessageFormatAdapter,
  MessageFormatItem,
  MessageFormatRepository,
  ThreadHistoryAdapter,
} from "@assistant-ui/core";
import { cachedChatTimes, chatItemTimes, chatStorage, saveChatTimes } from "@/lib/chat-storage";
import { CHAT_CACHE_REFRESH } from "@/lib/chat-cache";
import { noteChatActivity } from "@/lib/chat-activity";

const PREFIX = "sub2chat:";
/** 线程列表在存储里的键(和 createLocalStorageAdapter 的约定一致) */
export const THREADS_KEY = `${PREFIX}threads`;
export const MESSAGES_KEY_PREFIX = `${PREFIX}messages:`;
const mutationTails = new Map<string, Promise<void>>();

function queued<T>(key: string, operation: () => Promise<T>): Promise<T> {
  const previous = mutationTails.get(key) ?? Promise.resolve();
  const result = previous.then(operation);
  const tail = result.then(
    () => undefined,
    () => undefined,
  );
  mutationTails.set(key, tail);
  void tail.then(() => {
    if (mutationTails.get(key) === tail) mutationTails.delete(key);
  });
  return result;
}

function parseRepository<TMessage>(raw: string | null): MessageFormatRepository<TMessage> {
  if (!raw) return { messages: [] };
  try {
    const parsed = JSON.parse(raw) as MessageFormatRepository<TMessage>;
    if (!parsed || !Array.isArray(parsed.messages)) return { messages: [] };
    return parsed;
  } catch {
    return { messages: [] };
  }
}

function IndexedDbHistoryProvider({ children }: { children?: React.ReactNode }) {
  const aui = useAui();
  const auiRef = useRef(aui);
  useEffect(() => {
    auiRef.current = aui;
  });

  const history = useMemo<ThreadHistoryAdapter>(() => {
    const getRemoteId = async (initialize: boolean) => {
      const item = auiRef.current.threadListItem;
      const current = item.getState().remoteId;
      if (current || !initialize) return current;
      return (await item.initialize()).remoteId;
    };

    return {
      async load() {
        return { messages: [] };
      },
      async append() {},
      withFormat<TMessage, TStorageFormat extends Record<string, unknown>>(
        formatAdapter: MessageFormatAdapter<TMessage, TStorageFormat>,
      ): GenericThreadHistoryAdapter<TMessage> {
        const keyFor = (remoteId: string) => `${PREFIX}messages:${remoteId}`;

        return {
          async load() {
            const remoteId = await getRemoteId(false);
            if (!remoteId) return { messages: [] };
            return parseRepository<TMessage>(await chatStorage.getItem(keyFor(remoteId)));
          },
          async append(item) {
            const remoteId = await getRemoteId(true);
            if (!remoteId) return;
            const key = keyFor(remoteId);
            await queued(key, async () => {
              const repository = parseRepository<TMessage>(await chatStorage.getItem(key));
              const id = formatAdapter.getId(item.message);
              const index = repository.messages.findIndex(
                (stored) => formatAdapter.getId(stored.message) === id,
              );
              if (index >= 0) repository.messages[index] = item;
              else repository.messages.push(item);
              repository.headId = id;
              await chatStorage.setItem(key, JSON.stringify(repository));
              noteChatActivity(remoteId);
            });
          },
          async update(item, localMessageId) {
            const remoteId = await getRemoteId(true);
            if (!remoteId) return;
            const key = keyFor(remoteId);
            await queued(key, async () => {
              const repository = parseRepository<TMessage>(await chatStorage.getItem(key));
              const index = repository.messages.findIndex(
                (stored) => formatAdapter.getId(stored.message) === localMessageId,
              );
              if (index >= 0) repository.messages[index] = item;
              else repository.messages.push(item);
              repository.headId = formatAdapter.getId(item.message);
              await chatStorage.setItem(key, JSON.stringify(repository));
              noteChatActivity(remoteId);
            });
          },
          async delete(items: MessageFormatItem<TMessage>[]) {
            const remoteId = await getRemoteId(false);
            if (!remoteId) return;
            const key = keyFor(remoteId);
            const deletedIds = new Set(items.map((item) => formatAdapter.getId(item.message)));
            await queued(key, async () => {
              const repository = parseRepository<TMessage>(await chatStorage.getItem(key));
              repository.messages = repository.messages.filter(
                (stored) => !deletedIds.has(formatAdapter.getId(stored.message)),
              );
              repository.headId = repository.messages.at(-1)
                ? formatAdapter.getId(repository.messages.at(-1)!.message)
                : null;
              await chatStorage.setItem(key, JSON.stringify(repository));
            });
          },
        };
      },
    };
  }, []);

  const adapters = useMemo(() => ({ history }), [history]);
  return <RuntimeAdapterProvider adapters={adapters}>{children}</RuntimeAdapterProvider>;
}

const baseAdapter = createLocalStorageAdapter({
  storage: chatStorage,
  prefix: PREFIX,
  titleGenerator: createSimpleTitleAdapter(),
});

export const indexedDbThreadAdapter = {
  ...baseAdapter,
  /** 线程列表带上每个聊天最后一条消息的时间(存储里消息记录最后写入的时间),侧栏悬停卡片和日期分段要用 */
  async list() {
    const result = await baseAdapter.list();
    const keys = result.threads.map((thread) => `${PREFIX}messages:${thread.remoteId}`);
    // 有缓存的时间就先用(不等服务端),后台取到最新的再更新;变了就让列表重新读一次
    const cached = cachedChatTimes();
    const request = chatItemTimes(keys).then((fresh) => {
      const changed = keys.some((key) => fresh[key] !== cached[key]);
      saveChatTimes(fresh);
      if (changed && Object.keys(cached).length) {
        window.dispatchEvent(new CustomEvent(CHAT_CACHE_REFRESH, { detail: THREADS_KEY }));
      }
      return fresh;
    }).catch(() => ({} as Record<string, string>));
    const times = Object.keys(cached).length ? cached : await request;
    return {
      ...result,
      threads: result.threads.map((thread) => {
        const time = (times as Record<string, string>)[`${PREFIX}messages:${thread.remoteId}`];
        if (!time) return thread;
        const lastMessageAt = new Date(time);
        noteChatActivity(thread.remoteId, lastMessageAt);
        return { ...thread, lastMessageAt };
      }),
    };
  },
  unstable_Provider: IndexedDbHistoryProvider,
};
