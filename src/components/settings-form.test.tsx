// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SettingsForm } from "./settings-form";

vi.mock("next/link", () => ({ default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a> }));
globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;
window.matchMedia ??= ((query: string) => ({ matches: false, media: query, addEventListener() {}, removeEventListener() {} })) as never;

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("settings: several keys for one use", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.localStorage.setItem("mote.tangzhi.baseUrl", "https://relay.example.com");
    window.localStorage.setItem("mote.tangzhi.apiKey", "sk-video-1");
    window.localStorage.setItem("mote.tangzhi.videoKeysExtra", JSON.stringify(["sk-video-2", "sk-bad"]));
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit = {}) => {
      const key = new Headers(init.headers).get("x-tangzhi-key");
      if (url.startsWith("/api/key-check")) {
        if (key === "sk-bad") return Response.json({ error: "API Key 无效或已过期" }, { status: 400 });
        return Response.json({ message: `API Key 可用：${key}` });
      }
      if (url.startsWith("/api/models")) return Response.json([]);
      return Response.json({ models: [] });
    }));
  });

  it("verifies every video key and shows each result under its own row", async () => {
    render(<SettingsForm />);
    const field = await waitFor(() => screen.getByLabelText("视频的第 2 个 Key").closest(".key-field") as HTMLElement);
    await act(async () => { fireEvent.click(within(field).getByRole("button", { name: /验证/ })); });
    await waitFor(() => expect(field.textContent).toContain("第 3 个 Key：API Key 无效或已过期"));
    expect(field.textContent).toContain("API Key 可用：sk-video-1");
    expect(field.textContent).toContain("第 2 个 Key：API Key 可用：sk-video-2");
  });
});
