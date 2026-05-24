import * as React from "react";
import * as ReactDOM from "react-dom/client";
import { RecoilRoot } from "recoil";
import App from "./App";
import "./styles/index.css";

// 禁止右键菜单
document.addEventListener("contextmenu", (e) => e.preventDefault());

// 禁止文本选择（input/textarea 除外）
document.addEventListener("selectstart", (e) => {
  const target = e.target as HTMLElement;
  if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable) {
    return;
  }
  e.preventDefault();
});

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <RecoilRoot>
      <App />
    </RecoilRoot>
  </React.StrictMode>
);
