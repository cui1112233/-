@echo off
setlocal
cd /d "%~dp0"
set "LOG=%~dp0executor.log"
echo [%date% %time%] starting GiantMaterialExecutor.exe > "%LOG%"
start "Giant Material Executor" /min cmd /d /c ""%~dp0GiantMaterialExecutor.exe" >> "%LOG%" 2>&1"
timeout /t 2 /nobreak >nul
powershell -NoProfile -ExecutionPolicy Bypass -Command "$ok = Test-NetConnection -ComputerName 127.0.0.1 -Port 17861 -InformationLevel Quiet; if (-not $ok) { exit 1 }"
if errorlevel 1 (
  echo.
  echo 巨量素材执行器没有监听 127.0.0.1:17861。
  echo 这是启动日志：
  echo ----------------------------------------
  type "%LOG%"
  echo ----------------------------------------
  echo 请把上面的错误信息发给技术支持。
  pause
  exit /b 1
)
echo 巨量素材执行器已在后台启动。
echo 日志文件：%LOG%
endlocal
