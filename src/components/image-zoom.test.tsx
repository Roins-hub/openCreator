// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ImageZoom } from "./image-zoom";

afterEach(cleanup);

describe("ImageZoom", () => {
  it("zooms with the buttons and keys, and resets to fit", () => {
    render(<ImageZoom src="/a.png" alt="a" />);
    const level = screen.getByTitle(/恢复适应窗口/);
    expect(level.textContent).toBe("100%");
    fireEvent.click(screen.getByRole("button", { name: "放大" }));
    expect(level.textContent).toBe("125%");
    fireEvent.keyDown(window, { key: "+" });
    expect(level.textContent).toBe("156%");
    fireEvent.click(screen.getByRole("button", { name: "缩小" }));
    expect(level.textContent).toBe("125%");
    fireEvent.keyDown(window, { key: "0" });
    expect(level.textContent).toBe("100%");
    // 双击放大到 2 倍,再双击回到适应窗口
    const image = screen.getByRole("img", { name: "a" });
    fireEvent.doubleClick(image);
    expect(level.textContent).toBe("200%");
    fireEvent.doubleClick(image);
    expect(level.textContent).toBe("100%");
  });
});
