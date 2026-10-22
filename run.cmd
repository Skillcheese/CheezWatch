@echo off
rem Launches ScapeWatch Companion. Double-click to run.
cd /d "%~dp0"
if not exist node_modules (
  echo Installing dependencies...
  call npm install || goto :error
)
if not exist gauntlet_lab\dist\index.html (
  echo Building Gauntlet Lab...
  call npm run build:lab || goto :error
)
call npm start
exit /b 0
:error
echo.
echo Setup failed. See messages above.
pause
exit /b 1
