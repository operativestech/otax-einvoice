@echo off
setlocal
title OTax Local Signer Service

echo ========================================================
echo   OTax Local Signer Service (Required for USB Token)
echo ========================================================
echo.
echo This service allows the cloud website to communicate
echo with your local USB hardware token.
echo.

echo Working Directory: %CD%

echo [1/3] Checking Signer Binaries...
if not exist "EInvoicingSigner\EInvoicingSigner.exe" (
    echo X Signer binaries not found! 
    echo Downloading required components from GitHub...
    
    set "REPO_URL=https://github.com/ahmadabousetta/Egypt-tax-invoice-api.git"
    set "TEMP_DIR=temp_signer_repo"
    
    if exist "%TEMP_DIR%" rmdir /s /q "%TEMP_DIR%"
    git clone "%REPO_URL%" "%TEMP_DIR%"
    
    if %ERRORLEVEL% NEQ 0 (
        echo.
        echo X CRITICAL ERROR: Git clone failed! 
        echo Please ensure Git is installed (https://git-scm.com/)
        pause
        exit /b 1
    )

    if not exist "EInvoicingSigner" mkdir "EInvoicingSigner"
    xcopy "%TEMP_DIR%\c#_signer\publish\*" "EInvoicingSigner\" /E /Y
    rmdir /s /q "%TEMP_DIR%"
    echo OK: Binaries installed successfully.
) else (
    echo OK: Signer binaries found.
)

echo.
echo [2/3] Checking Node.js dependencies...
if not exist "node_modules" (
    echo Installing dependencies - please wait...
    call npm install
)

echo.
echo [3/3] Starting Signer Service...
echo To keep the connection alive, do NOT close this window.
echo.

:: Use npx to run with local tsx
call npx tsx agent/agent.ts

if %ERRORLEVEL% NEQ 0 (
    echo.
    echo X AGENT CRASHED! 
    echo Please check the error above.
    pause
)
pause
