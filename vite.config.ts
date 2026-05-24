// @ts-ignore
import { defineConfig } from "vite";
// @ts-ignore
import react from "@vitejs/plugin-react";

const host = process.env.TAURI_DEV_HOST;
const isGitHub = process.env.GITHUB_PAGES === 'true';

export default defineConfig(async () => ({
  base: isGitHub ? '/AI-CanvasPro/' : '/',
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
}));
