@echo off
echo ========================================
echo Egypt Trust EInvoiceSignerApp - Check
echo ========================================
echo.

echo [1/2] Checking Token Setup...
echo     ✓ Certificate verified (via screenshot)
echo     ✓ Token Manager active (via screenshot)
echo.

echo [2/2] Checking for EInvoiceSignerApp...
if exist "E:\E-Invoice\EInvoiceSignerApp\EInvoiceSignerApp.exe" (
    echo     ✓ EInvoiceSignerApp.exe FOUND!
    echo.
    echo     Please verify your config in:
    echo     E:\E-Invoice\EInvoiceSignerApp\EInvoiceSignerApp.exe.config
) else (
    echo     ✗ EInvoiceSignerApp.exe NOT found in E:\E-Invoice\EInvoiceSignerApp
    echo.
    echo     IMPORTANT:
    echo     You need the "EInvoiceSignerApp_1.0.3.zip" file.
    echo     This is DIFFERENT from the Activation driver.
    echo.
    echo     Please check:
    echo     1. Your emails from Egypt Trust
    echo     2. Contact Egypt Trust support to get this file
)

echo.
echo ========================================
pause
