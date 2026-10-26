// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ReferencePicker, type PickerAsset } from "./reference-picker";
import type { AssetFolder } from "@/lib/asset-store";

afterEach(cleanup);

const asset = (name: string, folder?: string, managed = true): PickerAsset => ({
  id: name, kind: "image", path: `users/x/uploads/${name}`, name, mimeType: "image/png", folder, managed,
});
const folders: AssetFolder[] = [{ id: "f1", name: "人物", createdAt: "2026-10-26T00:00:00Z" }];

function setup(assets = [asset("a.png", "f1"), asset("b.png"), asset("c.png", undefined, false)]) {
  const handlers = {
    onPick: vi.fn(), onClose: vi.fn(),
    onRename: vi.fn(async () => undefined), onTrash: vi.fn(async () => undefined), onMove: vi.fn(async () => undefined),
    onCreateFolder: vi.fn(async (name: string) => ({ id: "f2", name, createdAt: "2026-10-26T00:00:00Z" })),
    onRenameFolder: vi.fn(async () => undefined), onDeleteFolder: vi.fn(async () => undefined),
  };
  render(<ReferencePicker style={{}} assets={assets} folders={folders} loading={false} isAttached={() => false} {...handlers} />);
  return handlers;
}

describe("ReferencePicker", () => {
  it("picks an asset normally and filters by folder", () => {
    const handlers = setup();
    fireEvent.click(screen.getByTitle("b.png"));
    expect(handlers.onPick).toHaveBeenCalledWith(expect.objectContaining({ name: "b.png" }));
    fireEvent.click(screen.getByRole("tab", { name: /人物/ }));
    expect(screen.queryByTitle("b.png")).toBeNull();
    expect(screen.getByTitle("a.png")).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: /未分组/ }));
    // 只在输入框里、素材库没有记录的不算未分组
    expect(screen.queryByTitle("c.png")).toBeNull();
    expect(screen.getByTitle("b.png")).toBeTruthy();
  });

  it("renames an asset inline and deletes after a second click", async () => {
    const handlers = setup();
    fireEvent.click(screen.getAllByLabelText("重命名")[0]);
    const input = screen.getByLabelText("素材名称");
    expect((input as HTMLInputElement).value).toBe("a");
    fireEvent.change(input, { target: { value: "古风" } });
    await act(async () => { fireEvent.keyDown(input, { key: "Enter" }); });
    expect(handlers.onRename).toHaveBeenCalledWith("users/x/uploads/a.png", "古风");

    const remove = screen.getAllByLabelText("删除")[1];
    fireEvent.click(remove);
    expect(handlers.onTrash).not.toHaveBeenCalled();
    await act(async () => { fireEvent.click(remove); });
    expect(handlers.onTrash).toHaveBeenCalledWith(["users/x/uploads/b.png"]);
  });

  it("selects all managed assets and moves or deletes them in a batch", async () => {
    const handlers = setup();
    fireEvent.click(screen.getByText("管理"));
    fireEvent.click(screen.getByText("全选 2"));
    expect(screen.getByText("已选", { exact: false }).textContent).toContain("2");
    fireEvent.click(screen.getByRole("combobox", { name: "移到分组" }));
    await act(async () => { fireEvent.click(screen.getByRole("option", { name: /人物/ })); });
    expect(handlers.onMove).toHaveBeenCalledWith(["users/x/uploads/a.png", "users/x/uploads/b.png"], "f1");

    fireEvent.click(screen.getByTitle("b.png"));
    fireEvent.click(screen.getByRole("button", { name: /^删除$/ }));
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /确认删除 1 个/ })); });
    expect(handlers.onTrash).toHaveBeenCalledWith(["users/x/uploads/b.png"]);
  });

  it("creates and renames folders", async () => {
    const handlers = setup();
    fireEvent.click(screen.getByText("新建分组"));
    const input = screen.getByLabelText("分组名称");
    fireEvent.change(input, { target: { value: "场景" } });
    await act(async () => { fireEvent.keyDown(input, { key: "Enter" }); });
    expect(handlers.onCreateFolder).toHaveBeenCalledWith("场景", []);

    fireEvent.doubleClick(screen.getByRole("tab", { name: /人物/ }));
    const rename = screen.getByLabelText("分组名称");
    fireEvent.change(rename, { target: { value: "角色" } });
    await act(async () => { fireEvent.keyDown(rename, { key: "Enter" }); });
    expect(handlers.onRenameFolder).toHaveBeenCalledWith("f1", "角色");
  });
});
