@echo off
echo ============================================
echo Invoice Extraction System Setup for Windows
echo ============================================
echo.

echo This script will help you set up:
echo  1. Python service dependencies
echo  2. Tesseract OCR (manual download required)
echo  3. Poppler for PDF processing (manual download required)
echo  4. Database migrations
echo.

REM Check if we're in the right directory
if not exist "package.json" (
    echo ERROR: Please run this script from the project root directory
    pause
    exit /b 1
)

REM Check if invoice-extraction-service directory exists
if not exist "invoice-extraction-service" (
    echo ERROR: invoice-extraction-service directory not found
    echo Please ensure the Python service has been set up
    pause
    exit /b 1
)

echo Step 1: Setting up Python service...
echo ====================================
cd invoice-extraction-service

REM Run Python service setup
if exist "setup_windows.bat" (
    call setup_windows.bat
) else (
    echo ERROR: setup_windows.bat not found in invoice-extraction-service
    cd ..
    pause
    exit /b 1
)

cd ..
echo.

echo Step 2: Tesseract OCR Installation Check
echo =========================================
if exist "C:\Program Files\Tesseract-OCR\tesseract.exe" (
    echo [OK] Tesseract OCR is installed
) else (
    echo [!] Tesseract OCR NOT FOUND
    echo.
    echo Please install Tesseract OCR manually:
    echo 1. Download from: https://github.com/UB-Mannheim/tesseract/wiki
    echo 2. Run the installer
    echo 3. Install to: C:\Program Files\Tesseract-OCR\
    echo 4. Make sure to install English language data
    echo.
)
echo.

echo Step 3: Poppler Installation Check
echo ===================================
if exist "C:\Program Files\poppler\Library\bin" (
    echo [OK] Poppler is installed
) else (
    echo [!] Poppler NOT FOUND
    echo.
    echo Please install Poppler manually:
    echo 1. Download from: https://github.com/oschwartz10612/poppler-windows/releases
    echo 2. Extract the ZIP file
    echo 3. Move the extracted folder to: C:\Program Files\poppler\
    echo.
)
echo.

echo Step 4: Database Migrations
echo ============================
set /p run_migrations="Do you want to run database migrations now? (y/n): "
if /i "%run_migrations%"=="y" (
    echo Running migrations...
    npm run db:migrate
    if errorlevel 1 (
        echo.
        echo WARNING: Migration failed. Please check your database connection.
        echo You can run migrations manually later with: npm run db:migrate
    ) else (
        echo [OK] Migrations completed successfully
    )
) else (
    echo Skipping migrations. Run manually with: npm run db:migrate
)
echo.

echo ============================================
echo Setup Complete!
echo ============================================
echo.
echo Next steps:
echo  1. Make sure Tesseract OCR is installed (see above)
echo  2. Make sure Poppler is installed (see above)
echo  3. Run database migrations if you skipped them
echo.
echo To start the invoice extraction service:
echo   cd invoice-extraction-service
echo   start.bat
echo.
echo To start the main Next.js application:
echo   npm run dev
echo.
pause
