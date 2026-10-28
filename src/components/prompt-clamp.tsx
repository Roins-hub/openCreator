"use client";

import { useEffect, useState, type RefObject } from "react";
import { ChevronDown } from "lucide-react";

/**
 * 生成卡片上的长提示词默认只显示前几行(底部渐隐),下面一个「展开全部 / 收起」;
 * 提示词本来就短的不折叠、也不显示按钮。展开 / 收起时高度平滑过渡。
 */
export function usePromptClamp(ref: RefObject<HTMLElement | null>, lines = 3) {
  const [open, setOpen] = useState(false);
  const [metrics, setMetrics] = useState<{ full: number; clamp: number } | null>(null);

  useEffect(() => {
    const element = ref.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    const measure = () => {
      const lineHeight = parseFloat(getComputedStyle(element).lineHeight) || 26;
      const next = { full: element.scrollHeight, clamp: Math.round(lineHeight * lines) };
      setMetrics((current) => current && current.full === next.full && current.clamp === next.clamp ? current : next);
    };
    // 观察第一个子元素也行不通(内容是一串行内元素),直接看段落自身:宽度一变,折行就变,scrollHeight 跟着变
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref, lines]);

  const long = metrics ? metrics.full > metrics.clamp + 4 : false;
  return {
    open,
    long,
    className: `prompt-clamp ${long ? "is-long" : ""} ${open ? "is-open" : ""}`,
    style: {
      "--clamp-h": metrics ? `${metrics.clamp}px` : `${lines * 1.75}em`,
      "--full-h": metrics ? `${metrics.full}px` : "none",
    } as React.CSSProperties,
    toggle: long ? (
      <button type="button" className={`prompt-toggle ${open ? "is-open" : ""}`} aria-expanded={open}
        onClick={() => setOpen((value) => !value)}>
        {open ? "收起" : "展开全部"}<ChevronDown size={14} aria-hidden="true" />
      </button>
    ) : null,
  };
}
