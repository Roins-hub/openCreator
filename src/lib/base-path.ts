/**
 * 部署子路径。独立运行时为空;嵌入 Infinite-Canvas 时以 MOTE_BASE_PATH=/studio 构建。
 * Next 的 <Link> 与路由会自动加前缀,但手写的 fetch / src / href 不会,统一用 withBase 包一层。
 */
export const basePath = process.env.NEXT_PUBLIC_BASE_PATH || "";

export function withBase(path: string) {
  return `${basePath}${path}`;
}
