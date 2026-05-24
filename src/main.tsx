import * as React from "react";
import * as ReactDOM from "react-dom/client";
import { RecoilRoot } from "recoil";
import App from "./App";
import "./styles/index.css";

// Tauri 桌面环境禁止右键菜单（网站环境保留，便于刷新/调试）
try {
  if (typeof window !== 'undefined' && (window as any).__TAURI__) {
    document.addEventListener("contextmenu", (e) => e.preventDefault());

    document.addEventListener("selectstart", (e) => {
      const target = e.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable) {
        return;
      }
      e.preventDefault();
    });
  }
} catch {
  // 浏览器环境，不做限制
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <RecoilRoot>
      <App />
    </RecoilRoot>
  </React.StrictMode>
);
