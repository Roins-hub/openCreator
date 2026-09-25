import type { NextConfig } from "next";
import { readFileSync } from "node:fs";

// 构建期把 package.json 的版本号内联进产物，客户端可直接读 process.env.NEXT_PUBLIC_APP_VERSION，
// 无需把 package.json 打进前端包。cwd 始终是项目根目录（next build/dev/start 均如此）。
const appVersion = JSON.parse(readFileSync("package.json", "utf8")).version as string;

const nextConfig: NextConfig = {
  // Emit a self-contained production server for the portable desktop bundle.
  output: "standalone",
  // Allow this local machine's LAN URL to load development assets and HMR.
  // This only affects `next dev`; production is unchanged.
  allowedDevOrigins: ["192.168.71.180"],
  serverExternalPackages: [],
  env: { NEXT_PUBLIC_APP_VERSION: appVersion },
};

export default nextConfig;
