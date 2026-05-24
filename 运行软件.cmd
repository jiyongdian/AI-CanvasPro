@echo off
chcp 65001 >nul
title 谪仙漫剧 - 开发模式（支持热更新）
cd /d "%~dp0"

:: 确保 Node.js 和 Rust 在 PATH 中
set "PATH=C:\Program Files\nodejs;%USERPROFILE%\.cargo\bin;%PATH%"

:: 禁用增量编译，避免 Windows Defender 导致的文件锁定问题
set "CARGO_INCREMENTAL=0"

echo.
echo  ╔════════════════════════════════════════╗
echo  ║   谪仙漫剧 - 开发模式（支持热更新）    ║
echo  ╚════════════════════════════════════════╝
echo.

:: 检查 node_modules 是否存在
if not exist "node_modules\vite" (
    echo  [INFO] 检测到依赖未安装，正在安装...
    echo.
    call npm install
    if errorlevel 1 (
        echo.
        echo  [ERROR] 依赖安装失败，请检查网络连接或 Node.js 是否已安装
        pause
        exit /b 1
    )
    echo.
    echo  [INFO] 依赖安装完成！
    echo.
)

echo  [INFO] 启动开发服务器...
echo  [INFO] 修改代码后会自动刷新界面
echo.

:: 先杀掉可能占用端口的进程
taskkill /f /im node.exe >nul 2>&1

:: 启动 Tauri 开发模式
call npm run tauri:dev

pause
