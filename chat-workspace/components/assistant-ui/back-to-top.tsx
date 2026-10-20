"use client";

import { useEffect, useState, type FC } from "react";
import { useAuiState } from "@assistant-ui/react";
import { ArrowUpToLineIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/** 往下翻过一屏左右后,顶栏右侧出现「回到顶部」(和视频工作台同样位置、同样样式) */
const SHOW_AFTER = 480;
const viewport = () => document.querySelector<HTMLElement>('[data-slot="aui_thread-viewport"]');

export const BackToTop: FC = () => {
  // 换聊天、消息增减后视口可能重新挂载,重新绑定滚动监听
  const messageCount = useAuiState((s) => s.thread.messages.length);
  const threadId = useAuiState((s) => s.threads.mainThreadId);
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
  }, [messageCount, threadId]);

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
      className={cn("chat-back-to-top", visible && "is-visible")}
    >
      <ArrowUpToLineIcon className="size-3.5" />
      回到顶部
    </button>
  );
};
