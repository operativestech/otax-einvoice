@echo off
echo ========================================
echo Downloading Signer from GitHub...
echo ========================================
echo.

set "REPO_URL=https://github.com/ahmadabousetta/Egypt-tax-invoice-api.git"
set "TEMP_DIR=temp_signer_repo"
set "TARGET_DIR=%~dp0EInvoicingSigner"

echo [1/4] Cleaning up previous attempts...
if exist "%TEMP_DIR%" rmdir /s /q "%TEMP_DIR%"
if not exist "%TARGET_DIR%" mkdir "%TARGET_DIR%"

echo.
echo [2/4] Cloning repository...
git clone "%REPO_URL%" "%TEMP_DIR%"
if %ERRORLEVEL% NEQ 0 (
    echo.
    echo ✗ Git clone failed! 
    echo Please make sure Git is installed and you have internet access.
    pause
    exit /b 1
)

echo.
echo [3/4] Copying signer files...
if exist "%TEMP_DIR%\c#_signer\publish\EInvoicingSigner.exe" (
    xcopy "%TEMP_DIR%\c#_signer\publish\*" "%TARGET_DIR%\" /E /Y
    echo.
    echo ✓ Files copied successfully!
) else (
    echo.
    echo ✗ Signer executable not found in cloned repo!
    echo Checked path: %TEMP_DIR%\c#_signer\publish\EInvoicingSigner.exe
    pause
    exit /b 1
)

echo.
echo [4/4] Cleaning up...
rmdir /s /q "%TEMP_DIR%"

echo.
echo ========================================
echo SUCCESS! Signer is ready at:
echo %TARGET_DIR%
echo ========================================
echo.
echo Next step: Run setup_signer_config.bat (I will create this for you)
pause
