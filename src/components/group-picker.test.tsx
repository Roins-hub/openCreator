// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GroupPicker } from "./group-picker";
import type { Conversation } from "@/lib/types";

afterEach(cleanup);

const conversation = (id: string, title: string, groupId?: string, updatedAt = "2026-10-20T00:00:00.000Z"): Conversation => ({
  id, title, groupId, createdAt: updatedAt, updatedAt, messages: [],
});

describe("GroupPicker", () => {
  const setup = () => {
    const handlers = { onOpen: vi.fn(), onCreateIn: vi.fn(), onMoveCurrent: vi.fn(), onCreateGroup: vi.fn() };
    render(<GroupPicker groups={[{ id: "cat", name: "买猫猫" }]} activeId="a" {...handlers}
      conversations={[conversation("a", "当前对话"), conversation("b", "111", "cat")]} />);
    fireEvent.click(screen.getByRole("button", { name: /未分组/ }));
    fireEvent.click(screen.getByRole("option", { name: /买猫猫/ }));
    return handlers;
  };

  it("switches to a conversation inside the chosen folder", () => {
    const { onOpen } = setup();
    fireEvent.click(screen.getByRole("option", { name: "111" }));
    expect(onOpen).toHaveBeenCalledWith("b");
  });

  it("starts a new conversation in the folder, or moves the current one there", () => {
    const { onCreateIn, onMoveCurrent } = setup();
    fireEvent.click(screen.getByRole("button", { name: /把当前对话移到这里/ }));
    expect(onMoveCurrent).toHaveBeenCalledWith("cat");
    fireEvent.click(screen.getByRole("button", { name: /在这里新建对话/ }));
    expect(onCreateIn).toHaveBeenCalledWith("cat");
  });
});
