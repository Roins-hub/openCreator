import type { NextConfig } from "next";
import { readFileSync } from "node:fs";

// 构建期把 package.json 的版本号内联进产物，客户端可直接读 process.env.NEXT_PUBLIC_APP_VERSION，
// 无需把 package.json 打进前端包。cwd 始终是项目根目录（next build/dev/start 均如此）。
const appVersion = JSON.parse(readFileSync("package.json", "utf8")).version as string;
// 嵌入 Infinite-Canvas 时以子路径运行(MOTE_BASE_PATH=/studio);独立部署时留空。
const basePath = (process.env.MOTE_BASE_PATH || "").replace(/\/+$/, "");

const nextConfig: NextConfig = {
  // Emit a self-contained production server for the portable desktop bundle.
  output: "standalone",
  // Allow this local machine's LAN URL to load development assets and HMR.
  // This only affects `next dev`; production is unchanged.
  allowedDevOrigins: ["192.168.71.180"],
  serverExternalPackages: [],
  ...(basePath ? { basePath } : {}),
  env: { NEXT_PUBLIC_APP_VERSION: appVersion, NEXT_PUBLIC_BASE_PATH: basePath },
};

export default nextConfig;
