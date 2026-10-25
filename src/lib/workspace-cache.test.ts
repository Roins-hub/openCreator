// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from "vitest";
import { writeApiKey } from "./api-key";
import { emptyPromptLayout } from "./prompt-layout";
import { readWorkspaceCache, writeWorkspaceCache, type WorkspaceSnapshot } from "./workspace-cache";

const snapshot = (title: string): WorkspaceSnapshot => ({
  conversations: [{ id: "c1", title, createdAt: "2026-10-25T00:00:00.000Z", updatedAt: "2026-10-25T00:00:00.000Z", messages: [] }],
  favorites: [], prompts: [], groups: [{ id: "g1", name: "买猫猫" }], layout: emptyPromptLayout(),
});

describe("workspace cache", () => {
  beforeEach(() => window.localStorage.clear());

  it("keeps one snapshot per account", () => {
    writeApiKey("sk-a");
    writeWorkspaceCache(snapshot("A 的对话"));
    writeApiKey("sk-b");
    expect(readWorkspaceCache()).toBeUndefined();
    writeWorkspaceCache(snapshot("B 的对话"));
    writeApiKey("sk-a");
    expect(readWorkspaceCache()?.conversations[0].title).toBe("A 的对话");
  });

  it("skips snapshots that are too big or broken", () => {
    writeApiKey("sk-a");
    writeWorkspaceCache(snapshot("x".repeat(2_600_000)));
    expect(readWorkspaceCache()).toBeUndefined();
    const key = Object.keys(window.localStorage).find((name) => name.startsWith("mote.workspace.")) || "mote.workspace.x";
    window.localStorage.setItem(key, "{not json");
    expect(readWorkspaceCache()).toBeUndefined();
  });

  it("has nothing without a key", () => {
    writeWorkspaceCache(snapshot("无 Key"));
    expect(readWorkspaceCache()).toBeUndefined();
  });
});
