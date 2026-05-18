@echo off
echo Starting Invoice OCR Service...
echo.

cd /d "%~dp0.."

if not exist "ocr-service\node_modules" (
    echo Installing OCR service dependencies...
    cd ocr-service
    call npm install
    cd ..
    echo.
)

if not exist "ocr-service\.venv" (
    echo Creating Python virtual environment for PaddleOCR...
    C:\Python311\python.exe -m venv ocr-service\.venv
    echo Installing PaddleOCR dependencies...
    call ocr-service\.venv\Scripts\pip install -r ocr-service\requirements-ocr.txt
    echo.
)

echo Starting OCR service on port 4000...
node ocr-service/src/server.js
