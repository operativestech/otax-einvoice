@echo off
setlocal enabledelayedexpansion
chcp 65001 >nul
cls
echo ╔══════════════════════════════════════════════════╗
echo ║   OTax Agent Setup - One Time Installation      ║
echo ║   This will install the agent as a background   ║
echo ║   service that auto-starts with Windows.        ║
echo ╚══════════════════════════════════════════════════╝
echo.

REM ============================================
REM 0. Must run as Administrator
REM ============================================
net session >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Please run this script as Administrator!
    echo         Right-click ^> Run as administrator
    pause
    exit /b 1
)

set "AGENT_DIR=%~dp0"
echo [Setup] Agent directory: %AGENT_DIR%

REM ============================================
REM 1. Check Node.js
REM ============================================
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Node.js is not installed!
    echo         Download from https://nodejs.org/
    pause
    exit /b 1
)
for /f "tokens=*" %%i in ('node -v') do set NODE_VER=%%i
echo [Setup] Node.js: %NODE_VER%

REM ============================================
REM 2. Install dependencies
REM ============================================
echo [Setup] Installing dependencies...
cd /d "%AGENT_DIR%"
if not exist "package.json" (
    call npm init -y >nul 2>&1
)
call npm install ws tsx typescript @types/ws --save >nul 2>&1
echo [Setup] ✅ Dependencies installed.

REM ============================================
REM 3. Setup UTS (UniversalTokenSigner)
REM ============================================
set "UTS_EXE="
if exist "%AGENT_DIR%UniversalTokenSigner\UniversalTokenSigner.exe" (
    set "UTS_EXE=%AGENT_DIR%UniversalTokenSigner\UniversalTokenSigner.exe"
    echo [Setup] ✅ UTS found: !UTS_EXE!
) else (
    echo [Setup] ⚠️ UTS not found. Place UniversalTokenSigner folder next to agent.
    echo         Download it from the OTax Dashboard ^> Settings ^> Token Signature
)

REM ============================================
REM 4. Setup Legacy Signer (fallback)
REM ============================================
set "SIGNER_DIR=%AGENT_DIR%EInvoicingSigner"
if exist "%SIGNER_DIR%\EInvoicingSigner.exe" (
    echo [Setup] ✅ Legacy signer found.
) else (
    echo [Setup] ⚠️ Legacy EInvoicingSigner not found.
)

REM Copy PKCS11 driver
if exist "%SIGNER_DIR%" (
    if not exist "%SIGNER_DIR%\eps2003csp11.dll" (
        if exist "C:\Windows\System32\eps2003csp11.dll" (
            copy /Y "C:\Windows\System32\eps2003csp11.dll" "%SIGNER_DIR%\eps2003csp11.dll" >nul
            echo [Setup] ✅ PKCS11 driver copied.
        )
    )
)

REM ============================================
REM 5. Create the background runner VBS script
REM    (runs the BAT silently, no CMD window)
REM ============================================
echo [Setup] Creating silent runner...
(
echo Set WshShell = CreateObject^("WScript.Shell"^)
echo WshShell.Run chr^(34^) ^& "%AGENT_DIR%run_agent.bat" ^& chr^(34^), 0, False
) > "%AGENT_DIR%run_agent_silent.vbs"
echo [Setup] ✅ Silent runner created.

REM ============================================
REM 6. Create Windows Scheduled Task
REM    (auto-starts at logon, runs hidden)
REM ============================================
echo [Setup] Creating Windows Scheduled Task...

REM Delete old task if exists
schtasks /delete /tn "OTaxSigningAgent" /f >nul 2>&1

REM Create new task - runs at logon, hidden
schtasks /create /tn "OTaxSigningAgent" /tr "\"%AGENT_DIR%run_agent_silent.vbs\"" /sc onlogon /rl highest /f >nul 2>&1

if %errorlevel% equ 0 (
    echo [Setup] ✅ Scheduled Task "OTaxSigningAgent" created!
    echo         Agent will auto-start when Windows logs in.
) else (
    echo [Setup] ⚠️ Could not create scheduled task.
    echo         Falling back to Startup folder...
    
    REM Fallback: copy to Startup folder
    set "STARTUP=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"
    copy /Y "%AGENT_DIR%run_agent_silent.vbs" "!STARTUP!\OTaxAgent.vbs" >nul 2>&1
    echo [Setup] ✅ Added to Startup folder instead.
)

REM ============================================
REM 7. Start the agent NOW
REM ============================================
echo.
echo [Setup] Starting agent now...
start "" wscript.exe "%AGENT_DIR%run_agent_silent.vbs"

echo.
echo ╔══════════════════════════════════════════════════╗
echo ║   ✅ Setup Complete!                             ║
echo ╠══════════════════════════════════════════════════╣
echo ║                                                  ║
echo ║   The OTax Signing Agent is now:                ║
echo ║   • Running in the background                   ║
echo ║   • Set to auto-start with Windows              ║
echo ║   • Will auto-restart if it crashes             ║
echo ║                                                  ║
echo ║   To stop: Open Task Manager ^> find "node"      ║
echo ║   To uninstall: Run uninstall_agent.bat          ║
echo ║                                                  ║
echo ╚══════════════════════════════════════════════════╝
echo.
pause
