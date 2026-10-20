"use client";

import { useSyncExternalStore } from "react";
import { emptyThreadGroups, loadThreadGroups, saveThreadGroups, type ThreadGroups } from "@/lib/thread-groups";
import { mergeThreadGroups } from "@/lib/thread-groups-merge";

/**
 * 聊天分组的共享状态:侧栏和输入框里的「项目分组」用的是同一份,一边改了另一边立刻跟着变。
 * 同一账号可能在几台设备上同时打开:保存时先读服务器上最新的一份再合并,
 * 只改这台设备动过的分组和聊天,别的设备刚建的分组、刚移动的聊天不会被这台设备的旧数据覆盖。
 * 切回页面时也会重新读一次。
 */
const EMPTY = emptyThreadGroups();
let current: ThreadGroups = EMPTY;
let loading: Promise<void> | undefined;
let changedBeforeLoad = false;
// 这台设备见过的分组、动过分组的聊天
const knownGroups = new Set<string>();
const touchedThreads = new Set<string>();
let saving: Promise<void> = Promise.resolve();
const listeners = new Set<() => void>();

const emit = () => listeners.forEach((listener) => listener());

function adopt(value: ThreadGroups) {
  value.groups.forEach((group) => knownGroups.add(group.id));
  current = value;
  emit();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  loading ??= loadThreadGroups()
    .then((value) => {
      // 读取期间用户已经改过:以用户的修改为准(保存时会再合并一次)
      if (!changedBeforeLoad) adopt(value);
    })
    .catch(() => undefined);
  return () => listeners.delete(listener);
}

export const getThreadGroups = () => current;

export function setThreadGroups(next: ThreadGroups) {
  changedBeforeLoad = true;
  for (const id of new Set([...Object.keys(current.assign), ...Object.keys(next.assign)])) {
    if (current.assign[id] !== next.assign[id]) touchedThreads.add(id);
  }
  next.groups.forEach((group) => knownGroups.add(group.id));
  current = next;
  emit();
  saving = saving.then(async () => {
    const latest = await loadThreadGroups().catch(() => undefined);
    const merged = latest ? mergeThreadGroups(latest, current, knownGroups, touchedThreads) : current;
    await saveThreadGroups(merged);
    // 合并进来了别的设备的改动:界面也跟着更新
    if (JSON.stringify(merged) !== JSON.stringify(current)) adopt(merged);
  }).catch(() => undefined);
}

/** 切回页面时重新读一次(另一台设备可能刚改过) */
export function refreshThreadGroups() {
  return saving.then(() => loadThreadGroups()).then(adopt).catch(() => undefined);
}

if (typeof document !== "undefined") {
  let last = 0;
  const sync = () => {
    if (document.visibilityState !== "visible" || Date.now() - last < 15_000 || !listeners.size) return;
    last = Date.now();
    void refreshThreadGroups();
  };
  document.addEventListener("visibilitychange", sync);
  window.addEventListener("focus", sync);
}

export function useThreadGroups() {
  return useSyncExternalStore(subscribe, getThreadGroups, () => EMPTY);
}
