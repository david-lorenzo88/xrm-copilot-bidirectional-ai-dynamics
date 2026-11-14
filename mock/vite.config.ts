import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

/**
 * Default: the real MCP server runs in-page over an in-memory transport (fully offline).
 * `?mcp=http` talks to a running server instead (npm run demo:http) through this proxy.
 */
export default defineConfig({
  plugins: [react({ jsxRuntime: "classic" })],
  server: {
    port: 5173,
    proxy: { "/mcp": { target: process.env.MCP_SERVER_URL ?? "http://localhost:3001", changeOrigin: true } },
  },
  build: {
    chunkSizeWarningLimit: 4000,
    rollupOptions: { onwarn: (w, warn) => (w.code === "INVALID_ANNOTATION" ? undefined : warn(w)) },
  },
});
