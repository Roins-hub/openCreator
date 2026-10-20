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
  it("starts a new conversation inside a group", () => {
    const onCreateInGroup = vi.fn();
    render(<ConversationList {...props()} onCreateInGroup={onCreateInGroup} />);
    fireEvent.click(screen.getByRole("button", { name: "在电影感分组里新建对话" }));
    expect(onCreateInGroup).toHaveBeenCalledWith("g1");
  });

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
    fireEvent.click(screen.getByRole("combobox", { name: "移到分组" }));
    fireEvent.click(screen.getByRole("option", { name: "电影感" }));
    expect(p.onMove).toHaveBeenCalledWith(["b"], "g1");
  });

  it("filters by title or message content and hides groups without matches", () => {
    const p = props();
    p.conversations[2].messages = [{ id: "m1", role: "user", content: "晨雾里的鹿", createdAt: "" }] as Conversation["messages"];
    render(<ConversationList {...p} />);
    const search = screen.getByLabelText("搜索侧栏对话");

    fireEvent.change(search, { target: { value: "沙漠" } });
    expect(screen.getByRole("button", { name: "沙漠" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "雨夜" })).toBeNull();
    expect(screen.queryByRole("button", { name: /^电影感/ })).toBeNull();

    fireEvent.change(search, { target: { value: "鹿" } });
    expect(screen.getByRole("button", { name: "森林" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "沙漠" })).toBeNull();

    fireEvent.change(search, { target: { value: "雨" } });
    expect(screen.getByRole("button", { name: "雨夜" })).toBeTruthy();
    expect(screen.queryByText("未分组")).toBeNull();

    fireEvent.change(search, { target: { value: "不存在" } });
    expect(screen.getByText(/没有找到「不存在」/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "清空搜索" }));
    for (const name of ["雨夜", "沙漠", "森林"]) expect(screen.getByRole("button", { name })).toBeTruthy();
  });

  it("select-all only picks the conversations matching the search", () => {
    const p = props();
    render(<ConversationList {...p} />);
    fireEvent.change(screen.getByLabelText("搜索侧栏对话"), { target: { value: "森" } });
    fireEvent.click(screen.getByRole("button", { name: "管理对话" }));
    fireEvent.click(screen.getByLabelText("全选"));
    fireEvent.click(screen.getByRole("button", { name: /删除 1 个/ }));
    fireEvent.click(screen.getByRole("button", { name: "确认删除" }));
    expect(p.onDelete).toHaveBeenCalledWith(["c"]);
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
