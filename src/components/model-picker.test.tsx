// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ModelPicker } from "./model-picker";
import { genericVideoModel, toVideoModels } from "@/lib/tangzhi";
import { cachedModelPrefs } from "@/lib/model-prefs-client";

afterEach(cleanup);
// jsdom 没有 ResizeObserver / matchMedia(滑动底色和动画用)
globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;
window.matchMedia ??= ((query: string) => ({ matches: false, media: query, addEventListener() {}, removeEventListener() {} })) as never;

const models = ["alpha-video", "beta-video", "gamma-video"].map((id) => genericVideoModel(id));
// 没填 Key 时只改本地缓存;以前存在本地的旧数据先显示出来
const stored = () => cachedModelPrefs();

it("shows separate pool labels and keeps the selected API model ID", () => {
  window.localStorage.clear();
  const entries = toVideoModels({ data: [
    { model_name: "seedance-2.0-fast", tags: "视频生成,线路:号池1（最长30秒）", supported_endpoint_types: ["openai-video"], description: "720p；5s/10s/15s/30s" },
    { model_name: "seedance-2.0fast", tags: "视频生成,线路:号池2（最长15秒）", supported_endpoint_types: ["openai-video"], description: "720p；5s/10s/15s" },
  ] });
  const chosen: string[] = [];
  render(<ModelPicker models={entries} value="seedance-2.0-fast" onChange={(id) => chosen.push(id)} imageResolution="1k" />);
  fireEvent.click(screen.getByRole("button", { name: "选择模型" }));
  const list = screen.getByRole("listbox", { name: "模型" });
  expect(within(list).getByText("号池1（最长30秒）")).toBeTruthy();
  expect(within(list).getByText("号池2（最长15秒）")).toBeTruthy();
  fireEvent.click(within(list).getByRole("button", { name: /^seedance-2.0fast/ }));
  expect(chosen).toEqual(["seedance-2.0fast"]);
});

describe("ModelPicker 常用", () => {
  beforeEach(() => {
    window.localStorage.clear();
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
    expect(stored().recents).toEqual(["gamma-video"]);
    expect(within(list).queryByText("beta-video")).toBeNull();
  });

  it("clears the picked ones, then everything after confirming", () => {
    const list = openCommon();
    fireEvent.click(within(list).getByRole("button", { name: /管理/ }));
    fireEvent.click(within(list).getByRole("checkbox", { name: "选择 alpha-video" }));
    fireEvent.click(within(list).getByRole("button", { name: /清除所选/ }));
    expect(stored()).toEqual({ favorites: [], recents: ["beta-video", "gamma-video"] });
    fireEvent.click(within(list).getByRole("button", { name: /一键清空/ }));
    fireEvent.click(within(list).getByRole("button", { name: /确认清空/ }));
    expect(stored()).toEqual({ favorites: [], recents: [] });
  });
});
