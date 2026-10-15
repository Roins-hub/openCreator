/** 「视频工作台」地址。部署到其他域名时可用 NEXT_PUBLIC_VIDEO_WORKSPACE_URL 覆盖(构建期注入)。 */
export const VIDEO_WORKSPACE_URL =
  process.env.NEXT_PUBLIC_VIDEO_WORKSPACE_URL?.trim() || "https://vip.tangzhi.org";
