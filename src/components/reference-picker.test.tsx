// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { COMPOSER_DROP, ReferencePicker, type PickerAsset } from "./reference-picker";
import type { AssetFolder } from "@/lib/asset-store";

afterEach(cleanup);

const asset = (name: string, folder?: string, managed = true, source?: string): PickerAsset => ({
  id: name, kind: "image", path: `users/x/uploads/${name}`, name, mimeType: "image/png", folder, managed, source,
});
const folders: AssetFolder[] = [{ id: "f1", name: "人物", createdAt: "2026-10-26T00:00:00Z" }];

function setup(assets = [asset("a.png", "f1"), asset("b.png"), asset("c.png", undefined, false)]) {
  const handlers = {
    onPick: vi.fn(), onAttach: vi.fn(), onClose: vi.fn(),
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
    fireEvent.click(screen.getByRole("combobox", { name: "移到文件夹" }));
    await act(async () => { fireEvent.click(screen.getByRole("option", { name: /人物/ })); });
    expect(handlers.onMove).toHaveBeenCalledWith(["users/x/uploads/a.png", "users/x/uploads/b.png"], "f1");

    fireEvent.click(screen.getByTitle("b.png"));
    fireEvent.click(screen.getByRole("button", { name: /^删除$/ }));
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /确认删除 1 个/ })); });
    expect(handlers.onTrash).toHaveBeenCalledWith(["users/x/uploads/b.png"]);
  });

  it("creates and renames folders", async () => {
    const handlers = setup();
    fireEvent.click(screen.getByText("新建文件夹"));
    const input = screen.getByLabelText("文件夹名称");
    fireEvent.change(input, { target: { value: "场景" } });
    await act(async () => { fireEvent.keyDown(input, { key: "Enter" }); });
    expect(handlers.onCreateFolder).toHaveBeenCalledWith("场景", []);

    fireEvent.doubleClick(screen.getByRole("tab", { name: /人物/ }));
    const rename = screen.getByLabelText("文件夹名称");
    fireEvent.change(rename, { target: { value: "角色" } });
    await act(async () => { fireEvent.keyDown(rename, { key: "Enter" }); });
    expect(handlers.onRenameFolder).toHaveBeenCalledWith("f1", "角色");
  });

  it("drags an asset card onto a folder chip and moves it there", async () => {
    const handlers = setup();
    const chip = screen.getByRole("tab", { name: /人物/ });
    const original = document.elementFromPoint;
    document.elementFromPoint = () => chip;
    try {
      const tile = screen.getByTitle("b.png").parentElement as HTMLElement;
      fireEvent.pointerDown(tile, { button: 0, pointerType: "mouse", clientX: 10, clientY: 10 });
      fireEvent.pointerMove(window, { clientX: 40, clientY: 40 });
      expect(chip.parentElement?.className).toContain("drop");
      expect(document.querySelector(".card-drag.is-snapped")).toBeTruthy();
      await act(async () => { fireEvent.pointerUp(window, { clientX: 40, clientY: 40 }); });
      expect(handlers.onMove).toHaveBeenCalledWith(["users/x/uploads/b.png"], "f1");
      // 拖完补上的 click 不算选中素材
      fireEvent.click(screen.getByTitle("b.png"));
      expect(handlers.onPick).not.toHaveBeenCalled();
    } finally {
      document.elementFromPoint = original;
    }
  });

  it("renames a folder with the pencil button", async () => {
    const handlers = setup();
    fireEvent.click(screen.getByRole("button", { name: "重命名文件夹 人物" }));
    const input = screen.getByLabelText("文件夹名称");
    fireEvent.change(input, { target: { value: "主角" } });
    await act(async () => { fireEvent.keyDown(input, { key: "Enter" }); });
    expect(handlers.onRenameFolder).toHaveBeenCalledWith("f1", "主角");
  });

  it("splits uploads from AI-generated assets", () => {
    setup([asset("mine.png", undefined, true, "upload"), asset("ai.png")]);
    fireEvent.click(screen.getByRole("tab", { name: /我上传的/ }));
    expect(screen.getByTitle("mine.png")).toBeTruthy();
    expect(screen.queryByTitle("ai.png")).toBeNull();
    fireEvent.click(screen.getByRole("tab", { name: /AI 生成/ }));
    expect(screen.getByTitle("ai.png")).toBeTruthy();
    expect(screen.queryByTitle("mine.png")).toBeNull();
  });

  it("opens a zoomable preview from the magnifier button", () => {
    setup();
    fireEvent.click(screen.getAllByLabelText("放大查看")[1]);
    const dialog = screen.getByRole("dialog", { name: "素材预览" });
    expect(dialog.textContent).toContain("b.png");
    expect(dialog.querySelector(".image-zoom")).toBeTruthy();
  });

  it("deletes several folders at once from folder management", async () => {
    const handlers = setup();
    fireEvent.click(screen.getByText("管理文件夹"));
    fireEvent.click(screen.getByText("全选 1"));
    const tools = document.querySelector(".folder-bar-tools") as HTMLElement;
    fireEvent.click(within(tools).getByRole("button", { name: /^删除$/ }));
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /确认删除 1 个文件夹/ })); });
    expect(handlers.onDeleteFolder).toHaveBeenCalledWith("f1");
  });

  it("drops an asset card onto the composer to attach it", async () => {
    const handlers = setup();
    const composer = document.createElement("div");
    composer.dataset.dropTarget = COMPOSER_DROP;
    composer.setAttribute("data-drop-external", "");
    document.body.append(composer);
    const original = document.elementFromPoint;
    document.elementFromPoint = () => composer;
    try {
      const tile = screen.getByTitle("b.png").parentElement as HTMLElement;
      fireEvent.pointerDown(tile, { button: 0, pointerType: "mouse", clientX: 10, clientY: 10 });
      fireEvent.pointerMove(window, { clientX: 60, clientY: 300 });
      expect(composer.classList.contains("is-card-drop-hover")).toBe(true);
      await act(async () => { fireEvent.pointerUp(window, { clientX: 60, clientY: 300 }); });
      expect(handlers.onAttach).toHaveBeenCalledWith([expect.objectContaining({ name: "b.png" })]);
      expect(composer.classList.contains("is-card-drop-hover")).toBe(false);
    } finally {
      document.elementFromPoint = original;
      composer.remove();
    }
  });
});
