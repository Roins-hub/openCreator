"use client";

import { useLayoutEffect, useRef } from "react";

/**
 * 分段按钮的「选中块」:一块独立的底色跟着 .selected 的按钮滑过去,而不是瞬间跳过去。
 * 用法:容器加 ref={containerRef} 和 has-slider 类,子元素里放 {indicator}。
 * 位置直接写到 DOM 上(每次渲染后量一次,容器尺寸变化时再量),第一次定位不带动画。
 */
export function useSlidingIndicator<T extends HTMLElement>() {
  const containerRef = useRef<T>(null);
  const indicatorRef = useRef<HTMLSpanElement>(null);

  useLayoutEffect(() => {
    const container = containerRef.current;
    const indicator = indicatorRef.current;
    if (!container || !indicator) return;
    const place = () => {
      const selected = container.querySelector<HTMLElement>(":scope > .selected");
      if (!selected) { indicator.style.opacity = "0"; return; }
      indicator.style.opacity = "1";
      indicator.style.width = `${selected.offsetWidth}px`;
      indicator.style.height = `${selected.offsetHeight}px`;
      indicator.style.transform = `translate(${selected.offsetLeft}px, ${selected.offsetTop}px)`;
      // 第一次放到位之后才打开过渡,打开面板时不会从左上角滑进来
      if (!indicator.dataset.ready) requestAnimationFrame(() => { indicator.dataset.ready = "1"; });
    };
    place();
    const observer = new ResizeObserver(place);
    observer.observe(container);
    return () => observer.disconnect();
  });

  return { containerRef, indicator: <span ref={indicatorRef} className="slide-indicator" aria-hidden /> };
}
