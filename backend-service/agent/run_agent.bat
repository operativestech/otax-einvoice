@echo off
setlocal enabledelayedexpansion
chcp 65001 >nul
cls
echo ===================================================
echo   OTax Direct Agent v3.0 - Universal Token Signer
echo ===================================================
echo.

REM Agent directory
set "AGENT_DIR=%~dp0"

REM ============================================
REM 1. Try to find and start UTS
REM ============================================
set "UTS_EXE="

REM Check common locations for UniversalTokenSigner.exe
if exist "%AGENT_DIR%UniversalTokenSigner\UniversalTokenSigner.exe" (
    set "UTS_EXE=%AGENT_DIR%UniversalTokenSigner\UniversalTokenSigner.exe"
)
if not defined UTS_EXE if exist "%AGENT_DIR%..\UniversalTokenSigner\bin\Release\net8.0-windows\UniversalTokenSigner.exe" (
    set "UTS_EXE=%AGENT_DIR%..\UniversalTokenSigner\bin\Release\net8.0-windows\UniversalTokenSigner.exe"
)
if not defined UTS_EXE if exist "%AGENT_DIR%..\..\UniversalTokenSigner\bin\Release\net8.0-windows\UniversalTokenSigner.exe" (
    set "UTS_EXE=%AGENT_DIR%..\..\UniversalTokenSigner\bin\Release\net8.0-windows\UniversalTokenSigner.exe"
)

REM Check if UTS is already running
set "UTS_RUNNING=0"
tasklist /FI "IMAGENAME eq UniversalTokenSigner.exe" 2>nul | find /I "UniversalTokenSigner.exe" >nul && set "UTS_RUNNING=1"

if "!UTS_RUNNING!"=="1" (
    echo [UTS] UniversalTokenSigner is already running. OK
) else if defined UTS_EXE (
    echo [UTS] Starting UniversalTokenSigner...
    echo [UTS] Path: !UTS_EXE!
    start "" "!UTS_EXE!"
    timeout /t 3 /nobreak >nul
    echo [UTS] Started.
) else (
    echo [UTS] UniversalTokenSigner.exe not found.
    echo [UTS] Agent will try to use legacy EInvoicingSigner if available.
)

REM ============================================
REM 2. Legacy signer check (fallback)
REM ============================================
set "SIGNER_DIR=%AGENT_DIR%EInvoicingSigner"

if not exist "%SIGNER_DIR%\EInvoicingSigner.exe" (
    echo [Legacy] EInvoicingSigner not found locally.
    set "DL_SIGNER=%USERPROFILE%\Downloads\otax-agent\EInvoicingSigner"
    if exist "!DL_SIGNER!\EInvoicingSigner.exe" (
        if not exist "%SIGNER_DIR%" mkdir "%SIGNER_DIR%"
        xcopy /Y /E /I "!DL_SIGNER!" "%SIGNER_DIR%" >nul
        echo [Legacy] Signer files copied from Downloads.
    ) else (
        echo [Legacy] No legacy signer available. UTS will be used.
    )
)

REM Copy PKCS11 driver if not present
if exist "%SIGNER_DIR%" (
    if not exist "%SIGNER_DIR%\eps2003csp11.dll" (
        if exist "C:\Windows\System32\eps2003csp11.dll" (
            copy /Y "C:\Windows\System32\eps2003csp11.dll" "%SIGNER_DIR%\eps2003csp11.dll" >nul
            echo [Legacy] PKCS11 driver copied.
        )
    )
)

REM ============================================
REM 3. Install Node.js dependencies
REM ============================================
if not exist "%AGENT_DIR%node_modules\ws" (
    echo [Setup] Installing dependencies...
    cd /d "%AGENT_DIR%"
    call npm init -y >nul 2>&1
    call npm install ws tsx --save >nul 2>&1
    echo [Setup] Dependencies installed.
)

echo.
echo   UTS: !UTS_EXE!
echo   Legacy Signer: %SIGNER_DIR%
echo   Agent will auto-restart if it stops.
echo   Close this window to stop the agent.
echo ===================================================
echo.

:restart_loop
echo [%date% %time%] Starting agent...
cd /d "%AGENT_DIR%"
npx -y tsx agent.ts
echo.
echo [%date% %time%] Agent stopped. Restarting in 5 seconds...
echo Press Ctrl+C to stop.
timeout /t 5 /nobreak >nul
goto restart_loop
