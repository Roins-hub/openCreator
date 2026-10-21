"use client";

import type { useAui } from "@assistant-ui/react";
import { moveThreads } from "@/lib/thread-groups";
import { getThreadGroups, setThreadGroups } from "@/lib/thread-groups-store";

type Aui = ReturnType<typeof useAui>;

/** 切换聊天是异步的:等主聊天换好(最多约 1 秒)再继续 */
function whenSwitched(aui: Aui, ready: (state: ReturnType<Aui["threads"]["getState"]>) => boolean, then: () => void) {
  let tries = 0;
  const check = () => {
    if (ready(aui.threads.getState())) { then(); return; }
    if (++tries < 60) requestAnimationFrame(check);
  };
  check();
}

const mainComposer = (aui: Aui) => aui.threads.thread("main").composer();

/** 把输入框里写了一半的内容带到切过去的聊天里(那边已经有草稿时不覆盖) */
function carryDraft(aui: Aui, draft: string) {
  if (!draft.trim()) return;
  const composer = mainComposer(aui);
  if (!composer.getState().text.trim()) composer.setText(draft);
}

const currentDraft = (aui: Aui) => {
  try { return mainComposer(aui).getState().text; } catch { return ""; }
};

/** 在某个分组(undefined 为未分组)里开一个新聊天并切过去 */
export function startChatInGroup(aui: Aui, groupId: string | undefined, keepDraft = false) {
  const draft = keepDraft ? currentDraft(aui) : "";
  aui.threads.switchToNewThread();
  whenSwitched(aui, (state) => Boolean(state.mainThreadId) && state.mainThreadId === state.newThreadId, () => {
    const { mainThreadId } = aui.threads.getState();
    if (groupId) setThreadGroups(moveThreads(getThreadGroups(), [mainThreadId], groupId));
    carryDraft(aui, draft);
  });
}

/** 切到已有的聊天,输入框里的内容跟过去 */
export function openChat(aui: Aui, threadId: string) {
  const draft = currentDraft(aui);
  aui.threads.switchToThread(threadId);
  whenSwitched(aui, (state) => state.mainThreadId === threadId, () => carryDraft(aui, draft));
}
