// @vitest-environment jsdom

import { act, cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { MarqueeText } from "./marquee-text";

afterEach(cleanup);

describe("MarqueeText", () => {
  it("repeats the text and sets the scroll distance only when the title does not fit", () => {
    let measure: (() => void) | undefined;
    globalThis.ResizeObserver = class {
      constructor(callback: () => void) { measure = callback; }
      observe() {} unobserve() {} disconnect() {}
    } as unknown as typeof ResizeObserver;
    const { container } = render(<MarqueeText text="上元节夜晚的古城长街，千盏花灯高悬" />);
    const box = container.querySelector<HTMLElement>(".marquee")!;
    const copy = container.querySelector<HTMLElement>(".marquee-copy")!;
    Object.defineProperty(box, "clientWidth", { value: 120, configurable: true });
    Object.defineProperty(copy, "scrollWidth", { value: 300, configurable: true });
    act(() => measure?.());
    expect(box.classList.contains("is-overflow")).toBe(true);
    expect(box.style.getPropertyValue("--marquee-distance")).toBe("336px");
    expect(container.querySelectorAll(".marquee-copy")).toHaveLength(2);

    Object.defineProperty(copy, "scrollWidth", { value: 100, configurable: true });
    act(() => measure?.());
    expect(box.classList.contains("is-overflow")).toBe(false);
    expect(container.querySelectorAll(".marquee-copy")).toHaveLength(1);
  });
});
