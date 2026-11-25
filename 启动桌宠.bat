@echo off
setlocal
cd /d "%~dp0"

set "ELECTRON=%~dp0node_modules\electron\dist\electron.exe"
if exist "%ELECTRON%" goto launch

echo [DskPet] First run: installing dependencies, please wait...
call npm install --no-audit --no-fund
if errorlevel 1 goto fail

:launch
start "" /D "%~dp0" "%ELECTRON%" .
exit /b 0

:fail
echo.
echo [DskPet] npm install failed. Check your network,
echo then run "npm install" in this folder and try again.
pause
exit /b 1
