import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores([
    ".next/**",
    ".portable-cache/**",
    "dist/**",
    "out/**",
    "data/**",
    // 聊天程序是独立项目,用自己的 lint(oxlint)
    "chat-workspace/**",
    "next-env.d.ts",
  ]),
]);
