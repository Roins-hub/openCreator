"use client";

import { useEffect, useState, type FC } from "react";
import { useAuiState } from "@assistant-ui/react";
import { ArrowUpIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/** 往下翻过一屏左右后,对话区顶部正中出现「回到顶部」 */
const SHOW_AFTER = 480;
const viewport = () => document.querySelector<HTMLElement>('[data-slot="aui_thread-viewport"]');

export const BackToTop: FC = () => {
  // 换对话、消息增减后视口可能重新挂载,重新绑定滚动监听
  const messageCount = useAuiState((s) => s.thread.messages.length);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const root = viewport();
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
  }, [messageCount]);

  const scrollTop = () => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    viewport()?.scrollTo({ top: 0, behavior: reduce ? "auto" : "smooth" });
  };

  return (
    <button
      type="button"
      onClick={scrollTop}
      aria-label="回到顶部"
      title="回到顶部"
      aria-hidden={!visible}
      tabIndex={visible ? 0 : -1}
      className={cn(
        "aui-back-to-top border-border bg-background/90 text-muted-foreground hover:text-foreground absolute top-3 left-1/2 z-20 inline-flex h-8 items-center gap-1.5 rounded-full border px-3.5 text-xs font-medium shadow-md backdrop-blur transition-[opacity,translate] duration-200 ease-out motion-reduce:transition-opacity",
        visible
          ? "pointer-events-auto -translate-x-1/2 translate-y-0 opacity-100"
          : "pointer-events-none -translate-x-1/2 -translate-y-2 opacity-0",
      )}
    >
      <ArrowUpIcon className="size-3.5" />
      回到顶部
    </button>
  );
};
