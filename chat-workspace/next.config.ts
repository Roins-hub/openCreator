import { withAui } from "@assistant-ui/next";
import type { NextConfig } from "next";

// 挂在工作台域名的子路径下时(如 /chat),构建期传入 NEXT_PUBLIC_BASE_PATH
const basePath = (process.env.NEXT_PUBLIC_BASE_PATH || "").replace(/\/+$/, "");

const nextConfig: NextConfig = {
  ...(basePath ? { basePath } : {}),
  allowedDevOrigins: ["127.0.0.1"],
  output: "standalone",
  poweredByHeader: false,
};

export default withAui(nextConfig);
