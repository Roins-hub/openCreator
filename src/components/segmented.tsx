"use client";

import { useLayoutEffect, useRef, type ReactNode, type RefObject } from "react";

export type SegmentedOption<T extends string> = { value: T; label: ReactNode; title?: string; ariaLabel?: string };

/**
 * 一组按钮里选中的那个(aria-pressed="true")下面垫一块底,切换时滑过去(不是一下跳过去)。
 * 底块(.segmented-thumb)的位置直接写到容器的 CSS 变量上,不走 state,免得每次量完再渲染一遍。
 */
export function useSlidingThumb(ref: RefObject<HTMLElement | null>) {
  useLayoutEffect(() => {
    const root = ref.current;
    if (!root) return;
    const measure = () => {
      const active = root.querySelector<HTMLElement>("button[aria-pressed='true']");
      root.style.setProperty("--thumb-o", active ? "1" : "0");
      if (!active) return;
      root.style.setProperty("--thumb-x", `${active.offsetLeft}px`);
      root.style.setProperty("--thumb-w", `${active.offsetWidth}px`);
      // 第一次量好之前不放动画,不然一打开底块会从左边滑进来
      if (!root.dataset.ready) requestAnimationFrame(() => { root.dataset.ready = "1"; });
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    root.querySelectorAll("button").forEach((button) => observer.observe(button));
    return () => observer.disconnect();
  });
}

/** 分段切换:浅色轨道,选中段是一块纸色底,切换时滑过去 */
export function Segmented<T extends string>({ value, options, onChange, label, className = "" }: {
  value: T;
  options: SegmentedOption<T>[];
  onChange: (value: T) => void;
  label: string;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useSlidingThumb(ref);

  return (
    <div ref={ref} className={`segmented ${className}`} role="group" aria-label={label}>
      <span className="segmented-thumb" aria-hidden="true" />
      {options.map((option) => (
        <button type="button" key={option.value} aria-pressed={value === option.value} title={option.title}
          aria-label={option.ariaLabel} onClick={() => onChange(option.value)}>
          {option.label}
        </button>
      ))}
    </div>
  );
}
