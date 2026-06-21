@echo off
echo ╔══════════════════════════════════════════════════╗
echo ║   OTax Agent - Uninstall                        ║
echo ╚══════════════════════════════════════════════════╝
echo.

net session >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Please run as Administrator!
    pause
    exit /b 1
)

REM Kill running agent
taskkill /f /im "node.exe" /fi "WINDOWTITLE eq *agent*" >nul 2>&1

REM Remove scheduled task
schtasks /delete /tn "OTaxSigningAgent" /f >nul 2>&1
echo [✓] Scheduled task removed.

REM Remove from Startup
set "STARTUP=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"
if exist "%STARTUP%\OTaxAgent.vbs" (
    del "%STARTUP%\OTaxAgent.vbs" >nul 2>&1
    echo [✓] Startup entry removed.
)

REM Remove silent runner
set "AGENT_DIR=%~dp0"
if exist "%AGENT_DIR%run_agent_silent.vbs" del "%AGENT_DIR%run_agent_silent.vbs" >nul 2>&1

echo.
echo ✅ Agent uninstalled. It will no longer auto-start.
echo    Files are still in place if you want to re-install.
echo.
pause
