# 源极AI漫剧 - 开发模式预览启动脚本
# PowerShell 版本

$Host.UI.RawUI.WindowTitle = "源极AI漫剧 - 开发服务器"

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "   源极AI漫剧 - 开发模式预览" -ForegroundColor Yellow
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "正在启动开发服务器..." -ForegroundColor Green
Write-Host "前端地址: " -NoNewline
Write-Host "http://localhost:1420" -ForegroundColor Blue
Write-Host ""
Write-Host "按 Ctrl+C 停止服务器" -ForegroundColor Gray
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# 启动开发服务器
npm run dev
