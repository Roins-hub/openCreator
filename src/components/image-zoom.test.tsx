// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ImageZoom } from "./image-zoom";

beforeEach(() => {
  URL.createObjectURL = vi.fn(() => "blob:full-image");
  URL.revokeObjectURL = vi.fn();
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("ImageZoom", () => {
  it("zooms with the buttons and keys, and resets to fit", () => {
    const { container } = render(<ImageZoom src="blob:a" alt="a" />);
    // 原图加载完才显示(测试环境不会真的加载图片)
    fireEvent.load(container.querySelector("img[alt=a]") as HTMLImageElement);
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

describe("ImageZoom loading", () => {
  it("shows the thumbnail and download progress, then swaps in the original", async () => {
    let push: (chunk: Uint8Array) => void = () => undefined;
    let finish: () => void = () => undefined;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        push = (chunk) => controller.enqueue(chunk);
        finish = () => controller.close();
      },
    });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(body, { headers: { "content-length": "4", "content-type": "image/png" } })));
    const { container } = render(<ImageZoom src="/api/media/a.png" alt="cat" preview="/api/media/a.png?thumb=240" />);
    expect(container.querySelector(".image-zoom-preview")?.getAttribute("src")).toBe("/api/media/a.png?thumb=240");
    expect(screen.getByRole("progressbar").textContent).toContain("加载原图");

    await act(async () => { push(new Uint8Array([1, 2, 3, 4])); finish(); await new Promise((resolve) => setTimeout(resolve, 0)); });
    const full = container.querySelector<HTMLImageElement>("img[alt=cat]");
    expect(full?.getAttribute("src")).toBe("blob:full-image");
    expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe("100");

    act(() => { full?.dispatchEvent(new Event("load")); });
    expect(screen.queryByRole("progressbar")).toBeNull();
    expect(container.querySelector(".image-zoom-preview")).toBeNull();
  });

  it("falls back to loading the image directly when it cannot be downloaded", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("cors"); }));
    const { container } = render(<ImageZoom src="/api/media/b.png" alt="dog" />);
    expect(container.querySelector(".image-zoom-placeholder")).toBeTruthy();
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    expect(container.querySelector("img[alt=dog]")?.getAttribute("src")).toBe("/api/media/b.png");
  });
});
