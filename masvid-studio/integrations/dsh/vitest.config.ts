import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  root: fileURLToPath(new URL("./", import.meta.url)),
  esbuild: { jsx: "automatic" },
  server: { fs: { allow: [fileURLToPath(new URL("../../", import.meta.url))] } },
  test: {
    include: ["plugin/tests/**/*.test.tsx"],
    environment: "happy-dom",
    execArgv: ["--no-experimental-webstorage"],
  },
});
