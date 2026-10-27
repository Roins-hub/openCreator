// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AssetLibrary } from "./asset-library";
import type { Asset, AssetFolder } from "@/lib/asset-store";

vi.mock("@/lib/api-key", () => ({
  readApiKey: () => "sk-test",
  apiKeyHeaders: () => ({}),
  openSession: async () => undefined,
}));
vi.mock("next/link", () => ({ default: ({ children, href, ...props }: { children: React.ReactNode; href: string }) => <a href={href} {...props}>{children}</a> }));

const asset = (name: string, extra: Partial<Asset> = {}): Asset => ({
  id: `users/u/images/${name}`, kind: "image", path: `users/u/images/${name}`, name, mimeType: "image/png", size: 1024,
  createdAt: "2026-10-27T00:00:00Z", ...extra,
});

let assets: Asset[];
let folders: AssetFolder[];
let calls: { url: string; method: string; body?: unknown }[];

beforeEach(() => {
  assets = [asset("a.png", { folder: "f1" }), asset("b.png"), asset("c.png", { source: "chat" })];
  folders = [{ id: "f1", name: "人物", createdAt: "2026-10-27T00:00:00Z" }];
  calls = [];
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal("fetch", vi.fn(async (input: string, init?: RequestInit) => {
    const method = init?.method || "GET";
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ url: input, method, body });
    if (input.startsWith("/api/asset-folders")) {
      return Response.json(method === "GET" ? folders : method === "POST" ? { id: "f2", name: body?.name, createdAt: "" } : { name: body?.name });
    }
    if (input.startsWith("/api/assets") && method === "PATCH") {
      return Response.json(body.action === "rename" ? { path: body.path, name: `${body.name}.png` } : { paths: body.paths });
    }
    if (input.startsWith("/api/assets")) return Response.json(assets);
    return Response.json({});
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const loaded = async () => { await waitFor(() => expect(screen.getAllByRole("article").length).toBeGreaterThan(0)); };

describe("AssetLibrary folders", () => {
  it("filters by folder and moves a card into a folder by dragging it", async () => {
    render(<AssetLibrary />);
    await loaded();
    expect(screen.getAllByRole("article")).toHaveLength(2);
    fireEvent.click(screen.getByRole("tab", { name: /人物/ }));
    expect(screen.getAllByRole("article")).toHaveLength(1);
    fireEvent.click(screen.getByRole("tab", { name: /未分组/ }));
    const card = screen.getAllByRole("article")[0];

    const chip = screen.getByRole("tab", { name: /人物/ });
    const original = document.elementFromPoint;
    document.elementFromPoint = () => chip;
    try {
      fireEvent.pointerDown(card, { button: 0, pointerType: "mouse", clientX: 5, clientY: 5 });
      fireEvent.pointerMove(window, { clientX: 50, clientY: 50 });
      expect(document.querySelector(".card-drag.is-snapped")).toBeTruthy();
      await act(async () => { fireEvent.pointerUp(window, { clientX: 50, clientY: 50 }); });
    } finally {
      document.elementFromPoint = original;
    }
    expect(calls.find((call) => call.method === "PATCH")?.body).toEqual({ action: "move", paths: ["users/u/images/b.png"], folder: "f1" });
    await waitFor(() => expect(screen.queryAllByRole("article")).toHaveLength(0));
  });

  it("renames an asset from its menu", async () => {
    render(<AssetLibrary />);
    await loaded();
    fireEvent.click(screen.getByRole("button", { name: "b.png 的更多操作" }));
    fireEvent.click(screen.getByRole("button", { name: "重命名" }));
    const input = screen.getByLabelText("资产名称");
    expect((input as HTMLInputElement).value).toBe("b");
    fireEvent.change(input, { target: { value: "封面" } });
    await act(async () => { fireEvent.keyDown(input, { key: "Enter" }); });
    expect(calls.find((call) => call.method === "PATCH")?.body).toEqual({ action: "rename", path: "users/u/images/b.png", name: "封面" });
    await waitFor(() => expect(screen.getByText("封面.png")).toBeTruthy());
  });

  it("uses its own folders on the chat attachments page", async () => {
    render(<AssetLibrary scope="chat" />);
    await loaded();
    expect(calls.some((call) => call.url === "/api/asset-folders?scope=chat")).toBe(true);
    fireEvent.click(screen.getByText("新建文件夹"));
    const input = screen.getByLabelText("文件夹名称");
    fireEvent.change(input, { target: { value: "合同" } });
    await act(async () => { fireEvent.keyDown(input, { key: "Enter" }); });
    expect(calls.find((call) => call.method === "POST" && call.url === "/api/asset-folders")?.body).toEqual({ name: "合同", scope: "chat" });
  });

  it("opens a zoomable preview with an original-image button from a card", async () => {
    render(<AssetLibrary />);
    await loaded();
    fireEvent.click(screen.getByRole("button", { name: "放大查看 b.png" }));
    const dialog = screen.getByRole("dialog", { name: "素材预览" });
    expect(dialog.querySelector(".image-zoom")).toBeTruthy();
    expect(dialog.textContent).toContain("原图");
  });
});
