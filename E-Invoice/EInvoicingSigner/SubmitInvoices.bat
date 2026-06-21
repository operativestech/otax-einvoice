@echo off
set "app_dir=%~dp0"
:: Remove trailing backslash to prevent quote escaping issues
set "app_dir=%app_dir:~0,-1%"

:: CHANGED: Issuer Name to "MCDR CA 2022" based on certutil output
call "%app_dir%\EInvoicingSigner.exe" "%app_dir%" 09761969 "MCDR CA 2022"
pause
