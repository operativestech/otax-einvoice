@echo off
echo Installing RBAC dependencies...
echo.

echo Installing bcryptjs...
call npm install bcryptjs
if %errorlevel% neq 0 (
    echo Failed to install bcryptjs
    exit /b 1
)

echo Installing jsonwebtoken...
call npm install jsonwebtoken
if %errorlevel% neq 0 (
    echo Failed to install jsonwebtoken
    exit /b 1
)

echo Installing Prisma client...
call npm install @prisma/client
if %errorlevel% neq 0 (
    echo Failed to install @prisma/client
    exit /b 1
)

echo Installing type definitions...
call npm install --save-dev @types/bcryptjs @types/jsonwebtoken prisma
if %errorlevel% neq 0 (
    echo Failed to install type definitions
    exit /b 1
)

echo.
echo ✅ All dependencies installed!
echo.
echo Now run: npm run server
