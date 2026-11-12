@echo off
rem Screenshot import for Gauntlet Lab: builds what it needs, serves it on
rem localhost and opens it in the browser. Close this window to stop.
cd /d "%~dp0"
if not exist standalone\lab\index.html call npm run build:lab || goto :error
rem The Fortress icons came later, so their absence also means re-extract.
if not exist standalone\icons\fort\satchel_t1.png (
  if not exist app.asar (
    echo Copy the game's app.asar into %~dp0 first, then run this again.
    goto :error
  )
  node scripts/extract-icons.js || goto :error
)
call npm run build:standalone || goto :error
start "" http://localhost:8787/standalone/
node scripts/serve.js 8787
exit /b 0
:error
echo.
echo Failed. See messages above.
pause
exit /b 1
