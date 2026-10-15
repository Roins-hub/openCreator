import { configDefaults, defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  // 构建产物 .next/standalone 里会带一份源码副本,不要重复跑
  test: { environment: "node", exclude: [...configDefaults.exclude, ".next/**"] },
});
