import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

const here = fileURLToPath(new URL(".", import.meta.url));

/**
 * One self-contained HTML file per widget (Copilot loads ui:// resources as a
 * single document). Build each with `--mode <widget>`:
 *   vite build -c widgets/vite.config.ts --mode priority-list
 */
export default defineConfig(({ mode }) => {
  const widget = mode === "aging-dashboard" ? "aging-dashboard" : "priority-list";
  return {
    root: here,
    plugins: [react({ jsxRuntime: "classic" }), viteSingleFile()],
    define: { "process.env.NODE_ENV": JSON.stringify("production") },
    build: {
      outDir: resolve(here, "../dist/widgets"),
      emptyOutDir: false,
      reportCompressedSize: false,
      chunkSizeWarningLimit: 2000,
      rollupOptions: {
        input: resolve(here, `${widget}.html`),
        // zod ships comments rollup can't place; harmless.
        onwarn: (warning, warn) => (warning.code === "INVALID_ANNOTATION" ? undefined : warn(warning)),
      },
    },
  };
});
