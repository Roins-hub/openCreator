import { describe, expect, it } from "vitest";
import { buildTurns } from "./turns";
import type { Message } from "./types";

const user = (id: string): Message => ({ id, role: "user", content: id, createdAt: "", status: "complete" });
const video = (id: string, replyTo?: string): Message => ({
  id, role: "assistant", content: "", createdAt: "", status: "complete", taskIds: [`t-${id}`], ...(replyTo ? { replyTo } : {}),
});
const isVideo = (message: Message) => message.role === "assistant";
const shape = (messages: Message[]) => buildTurns(messages, isVideo)
  .map((turn) => turn.kind === "video" ? `${turn.message.id}<${turn.user?.id ?? "-"}` : turn.message.id);

describe("buildTurns", () => {
  it("pairs records with their own prompt even when concurrent submissions interleave", () => {
    expect(shape([user("u1"), user("u2"), video("a2", "u2"), video("a1", "u1")])).toEqual(["a2<u2", "a1<u1"]);
  });

  it("keeps the classic one-prompt-one-record history working", () => {
    expect(shape([user("u1"), video("a1"), user("u2"), video("a2")])).toEqual(["a1<u1", "a2<u2"]);
  });

  it("pairs legacy concurrent blocks in order", () => {
    expect(shape([user("u1"), user("u2"), video("a1"), video("a2")])).toEqual(["a1<u1", "a2<u2"]);
  });

  it("leaves a prompt whose submission failed on its own", () => {
    expect(shape([user("u0"), user("u1"), video("a1")])).toEqual(["u0", "a1<u1"]);
    expect(shape([user("u1"), video("a1"), user("u2")])).toEqual(["a1<u1", "u2"]);
  });

  it("does not hand a prompt that belongs to a new record to an old one", () => {
    expect(shape([user("u1"), user("u2"), video("a2", "u2"), video("a1")])).toEqual(["a2<u2", "a1<u1"]);
  });
});
