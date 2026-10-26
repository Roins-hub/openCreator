// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { usePresence } from "./use-presence";

afterEach(() => vi.useRealTimers());

describe("usePresence", () => {
  it("mounts immediately and stays mounted while the closing animation plays", () => {
    vi.useFakeTimers();
    const { result, rerender } = renderHook(({ open }) => usePresence(open, 170), { initialProps: { open: false } });
    expect(result.current).toEqual({ mounted: false, closing: false });
    rerender({ open: true });
    expect(result.current).toEqual({ mounted: true, closing: false });
    rerender({ open: false });
    expect(result.current).toEqual({ mounted: true, closing: true });
    act(() => { vi.advanceTimersByTime(170); });
    expect(result.current).toEqual({ mounted: false, closing: false });
    // 收起途中又打开:直接回到打开状态
    rerender({ open: true });
    rerender({ open: false });
    rerender({ open: true });
    act(() => { vi.advanceTimersByTime(300); });
    expect(result.current).toEqual({ mounted: true, closing: false });
  });
});
