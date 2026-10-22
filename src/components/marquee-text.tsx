"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";

/** 滚动速度(像素 / 秒)和首尾两份文字之间的空隙 */
const SPEED = 42;
const GAP = 36;

/**
 * 侧栏标题:平时放不下就显示省略号;鼠标移到这一行时,放不下的标题像数码屏一样向左循环滚动
 * (后面接一份同样的文字,无缝衔接)。只在放不下时才滚,量宽度用 ResizeObserver。
 * 是否在悬停由 CSS 决定(.history-row:hover / .ws-row:hover 下的 .marquee.is-overflow)。
 */
export function MarqueeText({ text, className = "" }: { text: string; className?: string }) {
  const boxRef = useRef<HTMLSpanElement>(null);
  const [distance, setDistance] = useState(0);

  useEffect(() => {
    const box = boxRef.current;
    const first = box?.querySelector<HTMLElement>(".marquee-copy");
    // 没有 ResizeObserver 的环境(测试等)就不滚,照常显示省略号
    if (!box || !first || typeof ResizeObserver === "undefined") return;
    const measure = () => setDistance(first.scrollWidth > box.clientWidth + 1 ? first.scrollWidth + GAP : 0);
    const observer = new ResizeObserver(measure);
    observer.observe(box);
    return () => observer.disconnect();
  }, [text]);

  const style = distance
    ? { "--marquee-distance": `${distance}px`, "--marquee-duration": `${Math.max(4, distance / SPEED).toFixed(1)}s` } as CSSProperties
    : undefined;
  return (
    <span ref={boxRef} className={`marquee ${distance ? "is-overflow" : ""} ${className}`} style={style}>
      <span className="marquee-track">
        <span className="marquee-copy">{text}</span>
        {distance > 0 && <span className="marquee-copy marquee-repeat" aria-hidden="true">{text}</span>}
      </span>
    </span>
  );
}
