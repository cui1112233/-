@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo 正在启动 CM 后台服务...
node server.js
echo.
echo 服务已停止。
pause
