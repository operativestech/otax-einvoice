@echo off
echo ========================================
echo Building ETA Signer (BouncyCastle)
echo ========================================
echo.

cd /d "%~dp0EtaSigner"

echo Step 1: Restoring NuGet packages...
dotnet restore
if %ERRORLEVEL% NEQ 0 (
    echo ERROR: Failed to restore packages
    pause
    exit /b 1
)

echo.
echo Step 2: Building Release configuration...
dotnet build --configuration Release
if %ERRORLEVEL% NEQ 0 (
    echo ERROR: Build failed
    pause
    exit /b 1
)

echo.
echo ========================================
echo BUILD SUCCESSFUL!
echo ========================================
echo.
echo Executable location:
echo %~dp0EtaSigner\bin\Release\net6.0\EtaSigner.exe
echo.
echo Next steps:
echo 1. Update server/server.ts with the new signInvoice function
echo 2. Restart your Node.js server
echo 3. Test with your Excel file
echo.
echo See BOUNCYCASTLE_SETUP_GUIDE.md for details
echo.
pause
