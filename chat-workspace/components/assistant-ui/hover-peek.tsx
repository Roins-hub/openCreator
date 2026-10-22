"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Clock3Icon as Clock3, FolderIcon as Folder, InboxIcon as Inbox } from "lucide-react";
import { fullTime, relativeTime } from "@/lib/relative-time";

const SHOW_DELAY = 200;
const CARD_WIDTH = 280;
const LEAVE_GRACE = 120;

export interface PeekInfo {
  title: string;
  /** 所在分组;没有时显示「未分组」 */
  group?: string;
  /** 最近更新 / 最后一条消息的时间 */
  time?: string | Date;
  /** 额外一行(如「3 条生成记录」) */
  extra?: ReactNode;
}

type Shown = PeekInfo & { top: number; left: number; key: string };

/**
 * 侧栏对话的悬停卡片:鼠标在某一行停一会儿,在它右边弹出完整标题、所在分组和最近时间,方便按时间找对话。
 * 用法:const peek = useHoverPeek(disabled);行上加 {...peek.bind(key, info)},再渲染 {peek.card}。
 * 移开、滚动、按下鼠标(开始拖动)时收起;disabled(管理 / 拖动中)时不弹。
 */
export function useHoverPeek(disabled = false) {
  const [shown, setShown] = useState<Shown>();
  const timer = useRef<number | undefined>(undefined);

  const hide = useCallback(() => {
    window.clearTimeout(timer.current);
    setShown(undefined);
  }, []);

  useEffect(() => {
    if (!shown) return;
    window.addEventListener("scroll", hide, true);
    window.addEventListener("resize", hide);
    return () => {
      window.removeEventListener("scroll", hide, true);
      window.removeEventListener("resize", hide);
    };
  }, [hide, shown]);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const bind = (key: string, info: PeekInfo) => ({
    onMouseEnter: (event: React.MouseEvent<HTMLElement>) => {
      if (disabled) return;
      const target = event.currentTarget;
      window.clearTimeout(timer.current);
      // 已经有卡片时(在相邻几行间移动)马上换,不再等
      const delay = shown ? 0 : SHOW_DELAY;
      timer.current = window.setTimeout(() => {
        if (!target.isConnected) return;
        const rect = target.getBoundingClientRect();
        const left = Math.min(rect.right + 10, window.innerWidth - CARD_WIDTH - 12);
        const top = Math.max(12, Math.min(rect.top - 4, window.innerHeight - 140));
        setShown({ ...info, key, top, left });
      }, delay);
    },
    // 移开后稍等一下再收:鼠标移到相邻一行时卡片直接换内容,不用重新等
    onMouseLeave: () => {
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setShown(undefined), LEAVE_GRACE);
    },
    onMouseDown: hide,
  });

  const date = shown?.time ? new Date(shown.time) : undefined;
  const valid = date && !Number.isNaN(date.getTime());
  const card = shown && !disabled && typeof document !== "undefined" ? createPortal(
    <div className="chat-hover-peek" role="tooltip" key={shown.key} style={{ top: shown.top, left: shown.left, width: CARD_WIDTH }}>
      <div className="chat-hover-peek-head">
        <strong>{shown.title}</strong>
        {valid && <time dateTime={date.toISOString()}>{relativeTime(date)}</time>}
      </div>
      <p>{shown.group ? <Folder size={13} /> : <Inbox size={13} />}{shown.group || "未分组"}</p>
      {valid && <p><Clock3 size={13} />最近更新 {fullTime(date)}</p>}
      {shown.extra && <p className="chat-hover-peek-extra">{shown.extra}</p>}
    </div>,
    document.body,
  ) : null;

  return { bind, card, hide };
}
