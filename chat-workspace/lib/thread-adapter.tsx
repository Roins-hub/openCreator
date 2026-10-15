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
import { chatStorage } from "@/lib/chat-storage";

const PREFIX = "sub2chat:";
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
  unstable_Provider: IndexedDbHistoryProvider,
};
