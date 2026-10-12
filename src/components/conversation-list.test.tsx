// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ConversationList } from "./conversation-list";
import type { Conversation } from "@/lib/types";

afterEach(cleanup);

const conversation = (id: string, title: string, groupId?: string): Conversation => ({
  id, title, groupId, createdAt: "", updatedAt: "", messages: [],
});
const props = () => ({
  conversations: [conversation("a", "雨夜", "g1"), conversation("b", "沙漠"), conversation("c", "森林")],
  groups: [{ id: "g1", name: "电影感" }],
  onOpen: vi.fn(), onRename: vi.fn(), onGroupsChange: vi.fn(),
  onDelete: vi.fn(async () => undefined), onMove: vi.fn(async () => undefined),
  onCreateGroup: vi.fn((name: string) => ({ id: "new", name })),
});

describe("ConversationList", () => {
  it("shows grouped and ungrouped conversations", () => {
    render(<ConversationList {...props()} />);
    expect(screen.getByRole("button", { name: /^电影感/, expanded: true }).textContent).toContain("1");
    expect(screen.getByText("未分组")).toBeTruthy();
    expect(screen.getByRole("button", { name: "沙漠" })).toBeTruthy();
  });

  it("selects everything and deletes it after confirmation", () => {
    const p = props();
    render(<ConversationList {...p} />);
    fireEvent.click(screen.getByRole("button", { name: "管理对话" }));
    fireEvent.click(screen.getByLabelText("全选"));
    expect(screen.getByText("已选 3")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /删除 3 个/ }));
    expect(p.onDelete).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "确认删除" }));
    expect(p.onDelete).toHaveBeenCalledWith(["a", "b", "c"]);
  });

  it("moves the selected conversations into a group", () => {
    const p = props();
    render(<ConversationList {...p} />);
    fireEvent.click(screen.getByRole("button", { name: "管理对话" }));
    fireEvent.click(screen.getByLabelText("沙漠"));
    fireEvent.change(screen.getByLabelText("移到分组"), { target: { value: "g1" } });
    expect(p.onMove).toHaveBeenCalledWith(["b"], "g1");
  });

  it("creates a group and dissolves one without deleting its conversations", () => {
    const p = props();
    render(<ConversationList {...p} />);
    fireEvent.click(screen.getByRole("button", { name: "新建分组" }));
    fireEvent.change(screen.getByPlaceholderText("分组名称，回车创建"), { target: { value: "国风" } });
    fireEvent.keyDown(screen.getByPlaceholderText("分组名称，回车创建"), { key: "Enter" });
    expect(p.onCreateGroup).toHaveBeenCalledWith("国风");

    fireEvent.click(screen.getByRole("button", { name: "电影感分组的更多操作" }));
    fireEvent.click(screen.getByRole("button", { name: /解散分组/ }));
    expect(p.onGroupsChange).toHaveBeenCalledWith([]);
    expect(p.onMove).toHaveBeenCalledWith(["a"], undefined);
    expect(p.onDelete).not.toHaveBeenCalled();
  });
});
