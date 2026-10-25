"use client";

import { useAui } from "@assistant-ui/react";
import { useEffect } from "react";
import { onChatCacheRefresh } from "@/lib/chat-cache";
import { MESSAGES_KEY_PREFIX, THREADS_KEY } from "@/lib/thread-adapter";
import { refreshThreadGroups } from "@/lib/thread-groups-store";

const GROUPS_KEY = "sub2chat:groups";

/**
 * 打开页面时先显示的是浏览器缓存;后台发现服务端的更新(别的设备刚聊过、刚改过分组)时,
 * 重新读对应的部分:聊天列表、分组,或当前打开的这个聊天(正在生成回复时不打断)。
 */
export function ChatCacheSync() {
  const aui = useAui();
  useEffect(() => onChatCacheRefresh((key) => {
    if (key === THREADS_KEY) {
      void aui.threads.reload?.();
      return;
    }
    if (key === GROUPS_KEY) {
      void refreshThreadGroups();
      return;
    }
    if (!key.startsWith(MESSAGES_KEY_PREFIX)) return;
    const state = aui.threads.getState();
    if (state.main?.isRunning) return;
    const main = state.threadItems.find((item) => item.id === state.mainThreadId);
    if ((main?.remoteId ?? state.mainThreadId) === key.slice(MESSAGES_KEY_PREFIX.length)) {
      void aui.threads.reloadMainThread?.();
    }
  }), [aui]);
  return null;
}
