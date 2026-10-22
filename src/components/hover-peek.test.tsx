// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useHoverPeek } from "./hover-peek";

afterEach(() => { cleanup(); vi.useRealTimers(); });

function Row({ disabled = false }: { disabled?: boolean }) {
  const peek = useHoverPeek(disabled);
  return <div>
    <div data-testid="row" {...peek.bind("c1", { title: "一只猫蹦蹦跳", group: "svasd", time: new Date(Date.now() - 3 * 60_000) })}>行</div>
    {peek.card}
  </div>;
}

describe("useHoverPeek", () => {
  it("shows the title, group and time after a short hover and hides on leave", () => {
    vi.useFakeTimers();
    render(<Row />);
    fireEvent.mouseEnter(screen.getByTestId("row"));
    expect(screen.queryByRole("tooltip")).toBeNull();
    act(() => { vi.advanceTimersByTime(500); });
    const card = screen.getByRole("tooltip");
    expect(card.textContent).toContain("一只猫蹦蹦跳");
    expect(card.textContent).toContain("svasd");
    expect(card.textContent).toContain("3 分钟前");
    fireEvent.mouseLeave(screen.getByTestId("row"));
    act(() => { vi.advanceTimersByTime(200); });
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("stays hidden while managing or dragging", () => {
    vi.useFakeTimers();
    render(<Row disabled />);
    fireEvent.mouseEnter(screen.getByTestId("row"));
    act(() => { vi.advanceTimersByTime(500); });
    expect(screen.queryByRole("tooltip")).toBeNull();
  });
});
