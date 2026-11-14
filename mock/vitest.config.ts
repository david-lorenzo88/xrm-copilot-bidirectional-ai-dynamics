import { defineConfig } from "vitest/config";

export default defineConfig({
  esbuild: { jsx: "transform" },
  test: { include: ["test/**/*.test.ts"], environment: "jsdom", testTimeout: 15_000 },
});
