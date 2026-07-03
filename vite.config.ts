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
  build: {
    // 提高警告阈值，vendor 分包后单块仍可能偏大属正常
    chunkSizeWarningLimit: 1000,
    rollupOptions: {
      output: {
        // 手动分包：把重量级第三方库拆出，与业务代码分离，
        // 利用浏览器长效缓存（业务改动不影响 vendor 缓存），并让首屏只加载所需 chunk
        manualChunks: {
          'react-vendor': ['react', 'react-dom', 'react-router-dom', 'recoil'],
          'antd-vendor': ['antd', '@ant-design/icons'],
          'flow-vendor': ['@xyflow/react'],
        },
      },
    },
  },
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
