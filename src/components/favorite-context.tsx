"use client";

import { createContext, useContext } from "react";
import { Star } from "lucide-react";

/**
 * 放大查看(生成结果、参考素材、资产)里的「收藏」:收藏状态由页面提供(工作台、资产页各自管着),
 * 收藏的东西都在资产页的「收藏」里。没有提供的地方不显示按钮。
 */
export type FavoriteTargets = {
  isFavorite: (path: string) => boolean;
  toggle: (path: string, favorite: boolean) => void;
};
export const FavoriteContext = createContext<FavoriteTargets | null>(null);

export function FavoriteButton({ path }: { path?: string }) {
  const favorites = useContext(FavoriteContext);
  if (!favorites || !path) return null;
  const on = favorites.isFavorite(path);
  return (
    <button type="button" className={`viewer-fav ${on ? "is-on" : ""}`} aria-pressed={on}
      onClick={(event) => { event.stopPropagation(); favorites.toggle(path, !on); }}
      title={on ? "取消收藏" : "收藏到资产库（资产页「收藏」里能看到）"}>
      <Star key={on ? "on" : "off"} size={15} fill={on ? "currentColor" : "none"} />{on ? "已收藏" : "收藏"}
    </button>
  );
}
