"use client";

import { useLayoutEffect, useRef } from "react";

/**
 * 选中块:一块底色跟着容器里选中的元素滑过去(和视频工作台的 sliding-indicator 一样)。
 * 容器加 ref={containerRef},子元素里放 {indicator};位置直接写到 DOM 上,第一次定位不带动画。
 */
export function useSlidingIndicator<T extends HTMLElement>(selector: string) {
  const containerRef = useRef<T>(null);
  const indicatorRef = useRef<HTMLSpanElement>(null);

  useLayoutEffect(() => {
    const container = containerRef.current;
    const indicator = indicatorRef.current;
    if (!container || !indicator) return;
    const place = () => {
      const selected = container.querySelector<HTMLElement>(selector);
      if (!selected) { indicator.style.opacity = "0"; return; }
      indicator.style.opacity = "1";
      indicator.style.width = `${selected.offsetWidth}px`;
      indicator.style.height = `${selected.offsetHeight}px`;
      indicator.style.transform = `translate(${selected.offsetLeft}px, ${selected.offsetTop}px)`;
      if (!indicator.dataset.ready) requestAnimationFrame(() => { indicator.dataset.ready = "1"; });
    };
    place();
    const observer = new ResizeObserver(place);
    observer.observe(container);
    return () => observer.disconnect();
  });

  return { containerRef, indicator: <span ref={indicatorRef} className="chat-slide-indicator" aria-hidden /> };
}
