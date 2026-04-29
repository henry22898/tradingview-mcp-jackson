@echo off
REM ============================================================================
REM Launch the Microsoft Store / UWP version of TradingView Desktop with the
REM Chrome DevTools Protocol enabled on port 9222. This is what the
REM tradingview-mcp server connects to.
REM
REM This script auto-discovers the install location via Get-AppxPackage so it
REM keeps working when TradingView updates and the version-stamped folder name
REM under WindowsApps changes.
REM
REM Usage:
REM   1. Close any running TradingView instance (this script will not kill it)
REM   2. Double-click this file, or run from a terminal
REM   3. Wait a few seconds for the chart to load
REM   4. Verify CDP by opening http://localhost:9222/json in any browser
REM ============================================================================

setlocal

REM Allow override via env var
if defined TRADINGVIEW_EXE (
    set "TV_EXE=%TRADINGVIEW_EXE%"
    goto :launch
)

REM Discover via Get-AppxPackage (no admin needed)
for /f "usebackq tokens=*" %%i in (`powershell -NoProfile -NonInteractive -Command "Get-AppxPackage -Name TradingView.Desktop | Select-Object -First 1 -ExpandProperty InstallLocation"`) do set "TV_DIR=%%i"

if not defined TV_DIR (
    echo ERROR: TradingView.Desktop AppX package not found.
    echo If you installed TradingView via the standalone installer, edit this
    echo script or set TRADINGVIEW_EXE to the absolute path of TradingView.exe.
    pause
    exit /b 1
)

set "TV_EXE=%TV_DIR%\TradingView.exe"

:launch
if not exist "%TV_EXE%" (
    echo ERROR: TradingView.exe not found at: "%TV_EXE%"
    pause
    exit /b 1
)

echo Found TradingView at: %TV_EXE%
echo Launching with --remote-debugging-port=9222 ...
start "" "%TV_EXE%" --remote-debugging-port=9222

echo.
echo Wait ~5 seconds for the chart to load, then verify CDP at:
echo   http://localhost:9222/json
echo.
endlocal
