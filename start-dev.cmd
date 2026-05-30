@echo off
chcp 65001 >nul
title 源极AI漫剧 - 开发服务器
cls
echo.
echo  ╔════════════════════════════════════════╗
echo  ║       源极AI漫剧 - 开发模式预览          ║
echo  ╚════════════════════════════════════════╝
echo.
echo  [INFO] 正在启动开发服务器...
echo  [URL]  http://localhost:1420
echo.
echo  按 Ctrl+C 停止服务器
echo  ────────────────────────────────────────
echo.

cd /d "%~dp0"
npm run dev

pause
