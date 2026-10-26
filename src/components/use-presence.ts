"use client";

import { useEffect, useState } from "react";

/**
 * 弹框收起时先留一会儿播放收起动画再卸载。
 * mounted:要不要渲染;closing:正在收起(加 is-closing 类,播放收起动画、不再响应点击)。
 */
export function usePresence(open: boolean, duration = 170) {
  const [shown, setShown] = useState(open);
  // 打开时立刻挂上(渲染时按上一次的 open 对比,不用等一轮 effect)
  const [previous, setPrevious] = useState(open);
  if (open !== previous) {
    setPrevious(open);
    if (open) setShown(true);
  }
  useEffect(() => {
    if (open || !shown) return;
    const timer = window.setTimeout(() => setShown(false), duration);
    return () => window.clearTimeout(timer);
  }, [open, shown, duration]);
  return { mounted: open || shown, closing: !open && shown };
}
