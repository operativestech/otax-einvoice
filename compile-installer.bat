@echo off
echo ===================================================
echo   Compiling OTax Agent Installer (Single File EXE)
echo ===================================================
cd /d "%~dp0\OTaxInstaller"
dotnet publish -r win-x64 -c Release --self-contained true -p:PublishSingleFile=true -p:IncludeNativeLibrariesForSelfExtract=true -p:EnableCompressionInSingleFile=true -o "..\backend-service\installer"
echo ===================================================
echo   Publish complete. Saved to backend-service\installer
echo ===================================================
pause
