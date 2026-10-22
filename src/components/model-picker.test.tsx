// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ModelPicker } from "./model-picker";
import { genericVideoModel } from "@/lib/tangzhi";

afterEach(cleanup);
// jsdom 没有 ResizeObserver / matchMedia(滑动底色和动画用)
globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;
window.matchMedia ??= ((query: string) => ({ matches: false, media: query, addEventListener() {}, removeEventListener() {} })) as never;

const models = ["alpha-video", "beta-video", "gamma-video"].map((id) => genericVideoModel(id));
const stored = (key: string) => JSON.parse(window.localStorage.getItem(key) || "[]");

describe("ModelPicker 常用", () => {
  beforeEach(() => {
    window.localStorage.setItem("mote.modelFavorites", JSON.stringify(["alpha-video"]));
    window.localStorage.setItem("mote.modelRecents", JSON.stringify(["beta-video", "gamma-video"]));
  });

  const openCommon = () => {
    render(<ModelPicker models={models} value="" onChange={() => undefined} imageResolution="1k" />);
    fireEvent.click(screen.getByRole("button", { name: "选择模型" }));
    return screen.getByRole("listbox", { name: "模型" });
  };

  it("removes a recently used model from 常用", () => {
    const list = openCommon();
    fireEvent.click(within(list).getByRole("button", { name: "移出常用 beta-video" }));
    expect(stored("mote.modelRecents")).toEqual(["gamma-video"]);
    expect(within(list).queryByText("beta-video")).toBeNull();
  });

  it("clears the picked ones, then everything after confirming", () => {
    const list = openCommon();
    fireEvent.click(within(list).getByRole("button", { name: /管理/ }));
    fireEvent.click(within(list).getByRole("checkbox", { name: "选择 alpha-video" }));
    fireEvent.click(within(list).getByRole("button", { name: /清除所选/ }));
    expect(stored("mote.modelFavorites")).toEqual([]);
    expect(stored("mote.modelRecents")).toEqual(["beta-video", "gamma-video"]);
    fireEvent.click(within(list).getByRole("button", { name: /一键清空/ }));
    fireEvent.click(within(list).getByRole("button", { name: /确认清空/ }));
    expect(stored("mote.modelRecents")).toEqual([]);
  });
});
