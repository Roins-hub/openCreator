// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ImageZoom } from "./image-zoom";
import { reportClientIssue } from "@/lib/client-log";

vi.mock("@/lib/client-log", () => ({ reportClientIssue: vi.fn() }));
const wait = (ms: number) => act(async () => { await new Promise((resolve) => setTimeout(resolve, ms)); });

beforeEach(() => {
  URL.createObjectURL = vi.fn(() => "blob:full-image");
  URL.revokeObjectURL = vi.fn();
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.mocked(reportClientIssue).mockClear(); });

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
    expect(screen.getByRole("progressbar").textContent).toContain("加载大图");

    await act(async () => { push(new Uint8Array([1, 2, 3, 4])); finish(); await new Promise((resolve) => setTimeout(resolve, 0)); });
    const full = container.querySelector<HTMLImageElement>("img[alt=cat]");
    expect(full?.getAttribute("src")).toBe("blob:full-image");
    expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe("100");

    act(() => { full?.dispatchEvent(new Event("load")); });
    expect(screen.queryByRole("progressbar")).toBeNull();
    expect(container.querySelector(".image-zoom-preview")).toBeNull();
  });

  it("retries once, then falls back to loading the image directly and reports it", async () => {
    const fetchMock = vi.fn(async () => { throw new TypeError("cors"); });
    vi.stubGlobal("fetch", fetchMock);
    const { container } = render(<ImageZoom src="/api/media/b.png" alt="dog" />);
    expect(container.querySelector(".image-zoom-placeholder")).toBeTruthy();
    await wait(700);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(container.querySelector("img[alt=dog]")?.getAttribute("src")).toBe("/api/media/b.png");
    expect(reportClientIssue).toHaveBeenCalledWith("image-progress-fallback", "network", { attempts: 2 });
  });

  it("recovers on the retry without falling back", async () => {
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new TypeError("offline"))
      .mockResolvedValueOnce(new Response(new Uint8Array([1, 2]), { headers: { "content-length": "2", "content-type": "image/png" } }));
    vi.stubGlobal("fetch", fetchMock);
    const { container } = render(<ImageZoom src="/api/media/c.png" alt="bird" />);
    await wait(700);
    expect(container.querySelector("img[alt=bird]")?.getAttribute("src")).toBe("blob:full-image");
    expect(reportClientIssue).not.toHaveBeenCalled();
  });

  it("reports the HTTP status when the server refuses both times", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("no", { status: 403 })));
    render(<ImageZoom src="/api/media/d.png" alt="fish" />);
    await wait(700);
    expect(reportClientIssue).toHaveBeenCalledWith("image-progress-fallback", "http-403", { attempts: 2 });
  });

  it("loads the original on demand and keeps showing the view image meanwhile", async () => {
    let n = 0;
    URL.createObjectURL = vi.fn(() => `blob:image-${++n}`);
    const fetchMock = vi.fn(async (url: string) => new Response(new Uint8Array(url.includes("view") ? [1] : [1, 2, 3]),
      { headers: { "content-type": "image/png" } }));
    vi.stubGlobal("fetch", fetchMock);
    const { container } = render(<ImageZoom src="/api/media/e.png?view=1" alt="egg" original="/api/media/e.png" />);
    await wait(0);
    const first = container.querySelector<HTMLImageElement>("img[alt=egg]");
    expect(first?.getAttribute("src")).toBe("blob:image-1");
    act(() => { first?.dispatchEvent(new Event("load")); });

    fireEvent.click(screen.getByRole("button", { name: "原图" }));
    // 原图出来之前接着显示刚才的大图,进度条写「加载原图」
    expect(container.querySelector("img.image-viewer-img:not([alt=egg])")?.getAttribute("src")).toBe("blob:image-1");
    expect(screen.getByRole("progressbar").textContent).toContain("加载原图");
    await wait(0);
    expect(fetchMock).toHaveBeenLastCalledWith("/api/media/e.png", expect.anything());
    const original = container.querySelector<HTMLImageElement>("img[alt=egg]");
    expect(original?.getAttribute("src")).toBe("blob:image-2");
    act(() => { original?.dispatchEvent(new Event("load")); });
    expect(screen.queryByRole("progressbar")).toBeNull();
    expect(screen.getByRole("button", { name: "原图 ✓" })).toHaveProperty("disabled", true);
  });
});
