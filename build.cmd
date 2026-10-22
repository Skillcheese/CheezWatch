@echo off
rem Builds Gauntlet Lab into extension\lab. Double-click to run, then load the
rem "extension" folder in chrome://extensions with "Load unpacked".
cd /d "%~dp0"
call npm run build:lab || goto :error
echo.
echo Done. In Chrome: chrome://extensions, enable Developer mode, Load unpacked, pick:
echo   %~dp0extension
echo Already loaded? Click the reload icon on the extension card instead.
pause
exit /b 0
:error
echo.
echo Build failed. See messages above.
pause
exit /b 1
