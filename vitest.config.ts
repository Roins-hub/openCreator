import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  // .next/standalone 里有构建时复制的源码,不要重复跑
  test: { environment: "node", exclude: ["**/node_modules/**", "**/.next/**", "**/dist/**"] },
});
