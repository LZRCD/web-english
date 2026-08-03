@echo off
setlocal
where pwsh.exe >nul 2>nul
if %errorlevel%==0 (
  pwsh.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\launch-wordloop.ps1"
) else (
  powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\launch-wordloop.ps1"
)
endlocal
