"use client";

import { useSyncExternalStore } from "react";
import { emptyThreadGroups, loadThreadGroups, saveThreadGroups, type ThreadGroups } from "@/lib/thread-groups";

/**
 * 聊天分组的共享状态:侧栏和输入框里的「项目分组」用的是同一份,一边改了另一边立刻跟着变。
 * 第一次有组件订阅时从存储读一次;每次修改都写回存储。
 */
const EMPTY = emptyThreadGroups();
let current: ThreadGroups = EMPTY;
let loading: Promise<void> | undefined;
let changedBeforeLoad = false;
const listeners = new Set<() => void>();

const emit = () => listeners.forEach((listener) => listener());

function subscribe(listener: () => void) {
  listeners.add(listener);
  loading ??= loadThreadGroups()
    .then((value) => {
      // 读取期间用户已经改过:以用户的修改为准
      if (!changedBeforeLoad) {
        current = value;
        emit();
      }
    })
    .catch(() => undefined);
  return () => listeners.delete(listener);
}

export const getThreadGroups = () => current;

export function setThreadGroups(next: ThreadGroups) {
  changedBeforeLoad = true;
  current = next;
  emit();
  void saveThreadGroups(next).catch(() => undefined);
}

export function useThreadGroups() {
  return useSyncExternalStore(subscribe, getThreadGroups, () => EMPTY);
}
