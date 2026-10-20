"use client";

import { useEffect, useState, type RefObject } from "react";
import { ArrowUpToLine } from "lucide-react";

/** 往下翻过一屏左右后,顶部正中出现「回到顶部」 */
const SHOW_AFTER = 480;

export function BackToTop({ scrollRootRef, resetKey }: {
  scrollRootRef: RefObject<HTMLElement | null>;
  /** 换对话等内容整体替换时,重新判断一次是否显示 */
  resetKey?: string;
}) {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const root = scrollRootRef.current;
    if (!root) return;
    let frame = 0;
    const check = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => setVisible(root.scrollTop > SHOW_AFTER));
    };
    check();
    root.addEventListener("scroll", check, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      root.removeEventListener("scroll", check);
    };
  }, [scrollRootRef, resetKey]);

  const scrollTop = () => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    scrollRootRef.current?.scrollTo({ top: 0, behavior: reduce ? "auto" : "smooth" });
  };

  return <button type="button" className={`back-to-top ${visible ? "is-visible" : ""}`} onClick={scrollTop}
    aria-label="回到顶部" title="回到顶部" tabIndex={visible ? 0 : -1} aria-hidden={!visible}>
    <ArrowUpToLine size={14} /> 回到顶部
  </button>;
}
