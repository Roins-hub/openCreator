// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PromptLibrary } from "./prompt-library";
import { emptyPromptLayout, hiddenCategoryList, type PromptLayout } from "@/lib/prompt-layout";

afterEach(cleanup);

const setup = () => {
  const onLayoutChange = vi.fn<(layout: PromptLayout) => void>();
  render(<PromptLibrary open onClose={vi.fn()} onUse={vi.fn()} customPrompts={[]} currentPrompt=""
    onSaveCustom={vi.fn()} onDeleteCustom={vi.fn(async () => undefined)}
    layout={emptyPromptLayout()} onLayoutChange={onLayoutChange} />);
  return { onLayoutChange };
};

describe("PromptLibrary category batch select", () => {
  it("selects every category and deletes them after a second click", () => {
    const { onLayoutChange } = setup();
    fireEvent.click(screen.getByRole("button", { name: "批量选择分类" }));
    const bar = screen.getByRole("toolbar", { name: "批量操作分类" });
    fireEvent.click(bar.querySelector("input[type=checkbox]") as HTMLInputElement);
    expect(bar.textContent).toMatch(/已选 [1-9]/);
    fireEvent.click(within(bar).getByRole("button", { name: /删除/ }));
    // 第一次只变成「确认删除」
    expect(onLayoutChange).not.toHaveBeenCalled();
    fireEvent.click(within(bar).getByRole("button", { name: /确认删除/ }));
    expect(onLayoutChange).toHaveBeenCalledTimes(1);
    // 内置分类被隐藏(可恢复),「我的提示词」不在其中
    const hidden = hiddenCategoryList(onLayoutChange.mock.calls[0][0]);
    expect(hidden.length).toBeGreaterThan(1);
    expect(hidden.some((item) => item.kind === "mine")).toBe(false);
    // 提示词库内容多,jsdom 里首次渲染较慢
  }, 30_000);
});
