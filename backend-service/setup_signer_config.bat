@echo off
echo ========================================
echo Configuring EInvoicingSigner...
echo ========================================

set "APP_DIR=%~dp0EInvoicingSigner"
set "PIN=09761969"
set "CERT_ISSUER=Egypt Trust Sealing CA"

echo.
echo [1/3] Creating SubmitInvoices.bat...
(
echo set "app_dir=%%~dp0"
echo call "%%app_dir%%EInvoicingSigner.exe" "%%app_dir%%" %PIN% "%CERT_ISSUER%"
) > "%APP_DIR%\SubmitInvoices.bat"

echo.
echo [2/3] Creating input.json for testing...
(
echo {
echo   "issuer": { "type": "B", "id": "123", "name": "Test" },
echo   "receiver": { "type": "B", "id": "456", "name": "Test Rec" },
echo   "documentType": "I",
echo   "documentTypeVersion": "1.0",
echo   "dateTimeIssued": "2023-10-10T00:00:00Z",
echo   "taxpayerActivityCode": "1234",
echo   "internalID": "12345",
echo   "invoiceLines": []
echo }
) > "%APP_DIR%\input.json"

echo.
echo [3/3] Configuration Complete!
echo.
echo To test signing:
echo 1. Connect your USB Token
echo 2. Run: %APP_DIR%\SubmitInvoices.bat
echo.
pause
