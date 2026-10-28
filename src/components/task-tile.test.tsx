// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TaskDetail, TaskTile } from "./task-tile";
import { Segmented } from "./segmented";
import type { Message } from "@/lib/types";

afterEach(cleanup);

const at = "2026-10-28T03:04:00Z";
const record = (overrides: Partial<Message>): Message => ({
  id: "a1", role: "assistant", content: "", createdAt: at, status: "complete",
  generation: { type: "image", providerName: "Tangzhi", modelName: "img-1", modelId: "img-1" }, ...overrides,
});
const images = (count: number) => Array.from({ length: count }, (_, index) => ({ kind: "image" as const, path: `users/u/images/${index}.png`, name: `${index}.png` }));

describe("grid tile", () => {
  it("shows up to four results and counts the rest", () => {
    const { container } = render(<TaskTile message={record({ media: images(6) })} kind="image" prompt="海边的灯塔" favorite={false} onOpen={() => {}} />);
    expect(container.querySelectorAll(".task-tile-shot")).toHaveLength(4);
    expect(screen.getByText("+2")).toBeTruthy();
    expect(screen.getByText(/6 张/)).toBeTruthy();
  });

  it("shows why a generation failed and opens the detail on click", () => {
    const onOpen = vi.fn();
    render(<TaskTile message={record({ status: "failed", error: "内容审核未通过" })} kind="image" prompt="猫" favorite={false} onOpen={onOpen} />);
    expect(screen.getByText("内容审核未通过")).toBeTruthy();
    expect(screen.getByText("失败")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "查看详情" }));
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it("starts a drag from a result", () => {
    const onDragMedia = vi.fn();
    const { container } = render(<TaskTile message={record({ media: images(1) })} kind="image" prompt="猫" favorite={false}
      onOpen={() => {}} onDragMedia={onDragMedia} />);
    fireEvent.pointerDown(container.querySelector(".task-tile-shot")!);
    expect(onDragMedia.mock.calls[0][1].path).toBe("users/u/images/0.png");
  });

  it("closes the detail with Escape", () => {
    const onClose = vi.fn();
    render(<TaskDetail message={record({})} onClose={onClose}><p>卡片</p></TaskDetail>);
    expect(screen.getByRole("dialog", { name: "生成详情" })).toBeTruthy();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe("segmented switch", () => {
  it("marks the chosen option and reports changes", () => {
    const onChange = vi.fn();
    render(<Segmented label="排列" value="list" onChange={onChange}
      options={[{ value: "list", label: "列表" }, { value: "grid", label: "网格" }]} />);
    expect(screen.getByRole("button", { name: "列表" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "网格" }));
    expect(onChange).toHaveBeenCalledWith("grid");
  });
});
