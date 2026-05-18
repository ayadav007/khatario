@echo off
REM GST Compliance Migrations Runner for Windows
REM This batch file helps run the Node.js migration script

echo ========================================
echo GST Compliance Migrations Runner
echo ========================================
echo.

REM Check if Node.js is installed
where node >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo ERROR: Node.js is not installed or not in PATH
    echo Please install Node.js from https://nodejs.org/
    pause
    exit /b 1
)

REM Check if .env file exists
if not exist ".env" (
    echo WARNING: .env file not found
    echo Please create .env file with database connection details
    echo.
    echo Example .env content:
    echo DATABASE_URL=postgresql://username:password@localhost:5432/khatario
    echo.
    pause
)

echo Running migrations...
echo.

REM Run the migration script
node scripts/run_gst_migrations.js

echo.
echo ========================================
echo Migration process completed
echo ========================================
pause

