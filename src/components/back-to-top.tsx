"use client";

import { useEffect, useState, type RefObject } from "react";
import { ArrowUpToLine } from "lucide-react";

/** 往下翻过一屏左右后,顶栏右侧出现「回到顶部」 */
const SHOW_AFTER = 480;

export function BackToTop({ scrollRootRef, resetKey, floating = false }: {
  /** 滚动的容器;不传时跟随整个页面(设置页这类整页滚动的页面) */
  scrollRootRef?: RefObject<HTMLElement | null>;
  /** 换对话等内容整体替换时,重新判断一次是否显示 */
  resetKey?: string;
  /** 浮在页面右下角(资产、附件这类长列表页:顶栏会滚走) */
  floating?: boolean;
}) {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const root = scrollRootRef ? scrollRootRef.current : null;
    if (scrollRootRef && !root) return;
    const target: HTMLElement | Window = root ?? window;
    let frame = 0;
    const check = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => setVisible((root ? root.scrollTop : window.scrollY) > SHOW_AFTER));
    };
    check();
    target.addEventListener("scroll", check, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      target.removeEventListener("scroll", check);
    };
  }, [scrollRootRef, resetKey]);

  const scrollTop = () => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const root = scrollRootRef ? scrollRootRef.current : window;
    root?.scrollTo({ top: 0, behavior: reduce ? "auto" : "smooth" });
  };

  return <button type="button" className={`back-to-top ${floating ? "is-floating" : ""} ${visible ? "is-visible" : ""}`} onClick={scrollTop}
    aria-label="回到顶部" title="回到顶部" tabIndex={visible ? 0 : -1} aria-hidden={!visible}>
    <ArrowUpToLine size={14} /> 回到顶部
  </button>;
}
