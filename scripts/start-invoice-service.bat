@echo off
echo ============================================
echo Starting Invoice Extraction Service
echo ============================================
echo.

REM Check if we're in the right directory
if not exist "invoice-extraction-service" (
    echo ERROR: invoice-extraction-service directory not found
    echo Please run this script from the project root directory
    pause
    exit /b 1
)

cd invoice-extraction-service

REM Check if virtual environment exists
if not exist "venv" (
    echo ERROR: Python virtual environment not found
    echo Please run setup first:
    echo   scripts\setup-invoice-extraction-windows.bat
    pause
    exit /b 1
)

REM Start the service
echo Starting Python service...
call start.bat

cd ..
