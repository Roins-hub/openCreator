import { describe, expect, it } from "vitest";
import { keepLocalMessages, mergeConversation, patchMessage } from "./conversation-merge";
import type { Conversation, Message } from "./types";

const message = (id: string, extra: Partial<Message> = {}): Message => ({
  id, role: "assistant", content: "", createdAt: "2026-10-12T00:00:00.000Z", status: "complete", ...extra,
});
const conversation = (messages: Message[], extra: Partial<Conversation> = {}): Conversation => ({
  id: "c1", title: "t", providerId: "tangzhi", modelId: "m", messages,
  createdAt: "2026-10-12T00:00:00.000Z", updatedAt: "2026-10-12T00:00:00.000Z", ...extra,
} as Conversation);

describe("mergeConversation", () => {
  it("keeps tasks the browser copy has not seen yet", () => {
    const stored = conversation([message("u1"), message("a1", { status: "processing" }), message("a2", { status: "processing" })]);
    const stale = conversation([message("u1"), message("a1", { status: "stopped" })], { title: "renamed" });
    const merged = mergeConversation(stored, stale);
    expect(merged.title).toBe("renamed");
    expect(merged.messages.map((item) => [item.id, item.status])).toEqual([
      ["u1", "complete"], ["a1", "processing"], ["a2", "processing"],
    ]);
  });

  it("only removes messages that are listed explicitly and never saves placeholders", () => {
    const stored = conversation([message("u1"), message("a1"), message("u2"), message("a2")]);
    const incoming = conversation([message("u2"), message("a2"), message("pending-x"), message("u3", { role: "user" })]);
    expect(mergeConversation(stored, incoming, ["u1", "a1"]).messages.map((item) => item.id)).toEqual(["u2", "a2", "u3"]);
    expect(mergeConversation(null, incoming).messages.map((item) => item.id)).toEqual(["u2", "a2", "u3"]);
  });
});

describe("browser-side reconciliation", () => {
  it("keeps in-flight local messages when the server copy replaces the conversation", () => {
    const saved = conversation([message("u1"), message("a1")]);
    const local = conversation([message("u1"), message("a1"), message("u2", { role: "user" }), message("pending-1")]);
    expect(keepLocalMessages(saved, local, new Set(["u2", "pending-1"])).messages.map((item) => item.id))
      .toEqual(["u1", "a1", "u2", "pending-1"]);
  });

  it("replaces a placeholder with the submitted task, once", () => {
    const local = conversation([message("u1"), message("pending-1", { status: "processing" }), message("pending-2")]);
    const task = message("a1", { status: "processing", taskIds: ["tz.1"] });
    const replaced = patchMessage(local, task, "pending-1");
    expect(replaced.messages.map((item) => item.id)).toEqual(["u1", "a1", "pending-2"]);
    expect(patchMessage(replaced, task, "pending-1")).toBe(replaced);
  });

  it("updates a single task message without touching its neighbours", () => {
    const local = conversation([message("a1", { status: "processing" }), message("a2", { status: "processing" })]);
    const done = patchMessage(local, message("a2", { status: "complete" }));
    expect(done.messages.map((item) => item.status)).toEqual(["processing", "complete"]);
    expect(patchMessage(local, message("missing"))).toBe(local);
  });
});
