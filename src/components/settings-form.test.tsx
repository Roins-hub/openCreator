// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SettingsForm } from "./settings-form";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("SettingsForm provider protocols", () => {
  it("offers Jimeng Visual and Kling API 2.0", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({
      providers: [{
        id: "provider-1", name: "测试", baseUrl: "https://example.com",
        apiKey: "secret", apiType: "ark", models: [],
      }],
    })));
    render(<SettingsForm />);

    const trigger = await screen.findByRole("combobox", { name: "接口类型" });
    expect(trigger.textContent).toContain("火山方舟");
    fireEvent.click(trigger);
    const options = screen.getAllByRole("option").map((option) => option.textContent);
    expect(options.some((text) => text?.includes("即梦"))).toBe(true);
    expect(options.some((text) => text?.includes("可灵"))).toBe(true);
  });

  it("shows AK and SK instead of API Key for Jimeng", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({
      providers: [{
        id: "jimeng", name: "即梦视觉",
        baseUrl: "https://visual.volcengineapi.com",
        apiKey: "", accessKeyId: "••••••••", secretAccessKey: "••••••••",
        apiType: "jimeng", models: [],
      }],
    })));
    render(<SettingsForm />);

    expect(await screen.findByLabelText("Access Key ID")).toBeTruthy();
    expect(screen.getByLabelText("Secret Access Key")).toBeTruthy();
    expect(screen.queryByLabelText("API Key")).toBeNull();
  });

  it("switches the suggested base URL when selecting Kling", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({
      providers: [{
        id: "provider-1", name: "测试",
        baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
        apiKey: "secret", apiType: "ark", models: [],
      }],
    })));
    render(<SettingsForm />);

    fireEvent.click(await screen.findByRole("combobox", { name: "接口类型" }));
    fireEvent.click(screen.getByRole("option", { name: /可灵/ }));
    await waitFor(() => expect(
      (screen.getByLabelText("Base URL") as HTMLInputElement).value,
    ).toBe("https://api-singapore.klingai.com"));
  });
});
