# Invoice Extraction System - Setup Guide

This guide will help you set up the invoice extraction system on Windows.

## Prerequisites

Before starting, ensure you have:
- **Node.js** (already installed for the main app)
- **Python 3.11 or later**
- **PostgreSQL** database (already set up)

## Installation Steps

### Step 1: Install Python (if not already installed)

1. Download Python 3.11+ from https://www.python.org/downloads/
2. Run the installer
3. **IMPORTANT:** Check "Add Python to PATH" during installation
4. Verify installation:
   ```
   python --version
   ```

### Step 2: Install Tesseract OCR

Tesseract is required for reading text from images and scanned PDFs.

1. Download Tesseract for Windows from:
   https://github.com/UB-Mannheim/tesseract/wiki

2. Run the installer (tesseract-ocr-w64-setup-x.x.x.exe)

3. During installation:
   - Install to default location: `C:\Program Files\Tesseract-OCR\`
   - Make sure to install **English language data** (checked by default)
   - Optionally install Hindi language data if you process Hindi invoices

4. Verify installation:
   ```
   "C:\Program Files\Tesseract-OCR\tesseract.exe" --version
   ```

### Step 3: Install Poppler for PDF Processing

Poppler is required for converting PDF pages to images for OCR.

1. Download Poppler for Windows from:
   https://github.com/oschwartz10612/poppler-windows/releases

2. Download the latest release ZIP file (e.g., `Release-XX.XX.X-X.zip`)

3. Extract the ZIP file

4. Move the extracted folder to: `C:\Program Files\poppler\`
   - The path should be: `C:\Program Files\poppler\Library\bin\`

5. Verify installation by checking if these files exist:
   - `C:\Program Files\poppler\Library\bin\pdftotext.exe`
   - `C:\Program Files\poppler\Library\bin\pdftoppm.exe`

### Step 4: Run Automated Setup Script

From your project root directory, run:

```bash
scripts\setup-invoice-extraction-windows.bat
```

This script will:
- Create a Python virtual environment
- Install all Python dependencies
- Verify Tesseract and Poppler installations
- Run database migrations

### Step 5: Run Database Migrations

If you didn't run migrations in Step 4, run them now:

```bash
npm run db:migrate
```

This creates the required database tables:
- `invoice_extraction_jobs` - Tracks extraction requests and results
- `invoice_templates` - Stores custom templates for specific vendors
- `supplier_name_aliases` - Improves supplier matching accuracy

## Starting the Services

### Option 1: Start Everything Together (Recommended)

1. Open **two** terminal windows

2. In Terminal 1, start the Python extraction service:
   ```bash
   cd invoice-extraction-service
   start.bat
   ```
   
   You should see:
   ```
   Starting Invoice Extraction Service on 127.0.0.1:5001
   ```

3. In Terminal 2, start the Next.js app (from project root):
   ```bash
   npm run dev
   ```

### Option 2: Start Python Service from Project Root

```bash
scripts\start-invoice-service.bat
```

Then start the Next.js app in another terminal:
```bash
npm run dev
```

## Verifying Installation

### 1. Check Python Service

Open a browser and go to:
```
http://127.0.0.1:5001/health
```

You should see:
```json
{
  "status": "healthy",
  "service": "invoice-extraction-service",
  "timestamp": "2024-01-15T10:30:00.000Z"
}
```

### 2. Check Templates

```
http://127.0.0.1:5001/templates
```

You should see at least one template (generic_indian_gst).

### 3. Test with a Sample Invoice

1. Go to your app: http://localhost:3000
2. Navigate to: **Purchases > New Purchase**
3. Click **"Upload Invoice"** button
4. Upload a PDF or image invoice
5. Wait 15-30 seconds for extraction
6. Review the extracted data

## Troubleshooting

### Python Service Won't Start

**Error:** `Python is not installed or not in PATH`

**Solution:**
1. Install Python from https://www.python.org/downloads/
2. During installation, check "Add Python to PATH"
3. Restart your terminal

---

**Error:** `Virtual environment not found`

**Solution:**
```bash
cd invoice-extraction-service
python -m venv venv
venv\Scripts\activate.bat
pip install -r requirements.txt
```

### Tesseract Not Found

**Error:** `Tesseract OCR not found`

**Solution:**
1. Install Tesseract to `C:\Program Files\Tesseract-OCR\`
2. If installed elsewhere, update `invoice-extraction-service/config.py`:
   ```python
   TESSERACT_CMD = r'C:\Your\Custom\Path\tesseract.exe'
   ```

### PDF Processing Fails

**Error:** `Poppler not found` or `Unable to convert PDF to image`

**Solution:**
1. Install Poppler to `C:\Program Files\poppler\`
2. Verify path exists: `C:\Program Files\poppler\Library\bin\`
3. If installed elsewhere, update `invoice-extraction-service/config.py`:
   ```python
   POPPLER_PATH = r'C:\Your\Custom\Path\poppler\Library\bin'
   ```

### Extraction Service Not Responding

**Error:** `Failed to connect to extraction service` (503)

**Solution:**
1. Make sure Python service is running:
   ```bash
   cd invoice-extraction-service
   start.bat
   ```
2. Check service URL in your `.env` file:
   ```
   INVOICE_EXTRACTION_SERVICE_URL=http://127.0.0.1:5001
   ```

### Low Extraction Accuracy

**Problem:** Extracted data is incorrect or incomplete

**Solutions:**
1. **Image Quality:** Use high-resolution images (300+ DPI)
2. **PDF Type:** Text-based PDFs work better than scanned images
3. **Invoice Format:** Create a custom template for recurring vendors
4. **Language:** If invoice contains Hindi, install Hindi language pack for Tesseract

### Database Migration Errors

**Error:** `relation "invoice_extraction_jobs" does not exist`

**Solution:**
```bash
npm run db:migrate
```

Make sure migrations 110, 111, and 112 ran successfully.

## Configuration

### Environment Variables

Add to your `.env` file:

```env
# Invoice Extraction Service URL
INVOICE_EXTRACTION_SERVICE_URL=http://127.0.0.1:5001

# Optional: Custom Tesseract path
# TESSERACT_CMD=C:\Program Files\Tesseract-OCR\tesseract.exe

# Optional: Custom Poppler path
# POPPLER_PATH=C:\Program Files\poppler\Library\bin
```

### Python Service Configuration

Edit `invoice-extraction-service/config.py` to customize:

```python
# Service port
PORT = 5001

# Max file size (bytes)
MAX_CONTENT_LENGTH = 10 * 1024 * 1024  # 10MB

# Processing timeout (seconds)
TIMEOUT_SECONDS = 60

# OCR languages (add Hindi: 'eng+hin')
OCR_LANGUAGE = 'eng'
```

## Production Deployment

### For Windows Server

1. Use **Windows Service** to run Python service automatically
2. Or use **Task Scheduler** to start on boot
3. Configure firewall to allow port 5001 (if needed)

### For Linux Server (Future)

1. Use **systemd** service for Python app
2. Use **Nginx** as reverse proxy
3. Docker deployment recommended

## Next Steps

Once installed, see:
- [User Guide](INVOICE_EXTRACTION_USER_GUIDE.md) - How to use the feature
- [Template Guide](INVOICE_TEMPLATE_GUIDE.md) - Creating custom templates

## Support

For issues, check:
1. Python service logs in terminal
2. Next.js app logs in browser console
3. Database logs for migration errors
4. GitHub issues (if applicable)
