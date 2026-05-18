# Invoice Extraction - User Guide

Learn how to use the invoice extraction feature to automatically fill purchase forms from uploaded invoices.

## Overview

The Invoice Extraction feature allows you to:
- Upload invoice PDFs or images
- Automatically extract supplier information, items, amounts, and taxes
- Review and edit extracted data
- Auto-fill purchase forms with one click
- Save time and reduce manual data entry errors

## How to Use

### Step 1: Navigate to New Purchase

1. Go to **Purchases** in the main menu
2. Click **"New Purchase"** button

### Step 2: Upload Invoice

1. Look for the **"Quick Fill from Invoice"** section at the top of the form
2. Click **"Upload Invoice"** button
3. Choose how to upload:
   - **Drag and drop** your invoice file into the upload area
   - **Click** the upload area to browse and select a file

**Supported file types:**
- PDF (.pdf)
- Images: JPG, JPEG, PNG, GIF, BMP, TIFF
- Maximum file size: 10MB

### Step 3: Wait for Extraction

Once you upload the file:
1. Click **"Extract Invoice Data"** button
2. Wait 15-30 seconds while the system processes your invoice
3. A progress bar shows the extraction status

**What's happening:**
- The system reads text from your invoice using OCR
- It identifies supplier details, invoice number, date, items, and amounts
- It matches suppliers and items from your catalog
- All extracted data is structured for review

### Step 4: Review Extracted Data

A review modal will appear showing:

**Supplier Information:**
- Supplier name and GSTIN
- If found in your system, you'll see match suggestions
- Select the correct supplier or create a new one

**Invoice Details:**
- Bill number
- Bill date
- Document type
- GST information

**Line Items:**
- Item names
- HSN/SAC codes
- Quantities and rates
- Tax rates
- Discounts

**Totals:**
- Subtotal
- Tax amounts
- Grand total

### Step 5: Edit if Needed

You can edit any extracted field:
- Click on any input field to modify the value
- Fix typos or incorrect extractions
- Add missing information
- Adjust quantities or rates

### Step 6: Accept and Fill Form

1. Review all extracted data
2. Make any necessary edits
3. Click **"Fill Purchase Form"** button
4. The main purchase form will be automatically filled with the extracted data

### Step 7: Complete the Purchase

1. Review the auto-filled form
2. Make any final adjustments
3. Add notes if needed
4. Click **"Save as Draft"** or **"Finalize Purchase"**

## Tips for Best Results

### Invoice Quality

**For Images:**
- Use high-resolution images (300+ DPI recommended)
- Ensure good lighting and clear text
- Keep invoice flat (no wrinkles or folds)
- Capture the entire invoice in the frame

**For PDFs:**
- Text-based PDFs work better than scanned images
- Single-page invoices process faster
- Ensure PDF is not password-protected

### Invoice Format

**Works best with:**
- Standard GST tax invoices
- Clear, structured layouts
- Machine-printed text
- Standard fonts

**May have issues with:**
- Handwritten invoices
- Complex multi-page invoices
- Poor quality scans
- Unusual formats

### Improving Accuracy

1. **Create Custom Templates** (Advanced)
   - For recurring vendors with consistent formats
   - See [Template Guide](INVOICE_TEMPLATE_GUIDE.md)

2. **Review and Correct**
   - Always review extracted data before accepting
   - Corrections help improve future extractions

3. **Maintain Supplier Catalog**
   - Keep supplier information up-to-date
   - Add GSTINs to supplier records for better matching

4. **Maintain Item Catalog**
   - Add HSN/SAC codes to items
   - Use consistent item names

## Common Use Cases

### Case 1: Regular Vendor Invoice

**Scenario:** You receive monthly invoices from the same supplier

**Steps:**
1. Upload the invoice
2. System matches supplier automatically
3. Items are matched from catalog
4. Quick review and accept
5. Time saved: 5+ minutes per invoice

### Case 2: New Vendor Invoice

**Scenario:** First-time purchase from a new supplier

**Steps:**
1. Upload the invoice
2. System extracts supplier details
3. Review and create new supplier
4. Items are extracted but need manual catalog entry
5. Next time, supplier will be matched automatically

### Case 3: Complex Invoice with Multiple Items

**Scenario:** Invoice with 10+ line items

**Steps:**
1. Upload the invoice
2. All items are extracted
3. Review quantities and rates
4. Items are matched from catalog or marked for creation
5. One-click fill saves significant time

## Troubleshooting

### Extraction Takes Too Long

**Problem:** Processing time exceeds 60 seconds

**Causes:**
- Very large file size (>10MB)
- Complex multi-page invoice
- Scanned image with poor quality

**Solutions:**
- Reduce file size by compressing images
- Split multi-page invoices
- Use text-based PDF instead of scanned image

### Incorrect Data Extracted

**Problem:** Extracted data is wrong or incomplete

**Solutions:**
1. **Edit in Review Modal:** Correct the data before accepting
2. **Check Image Quality:** Use higher resolution images
3. **Create Custom Template:** For recurring vendor formats
4. **Manual Entry:** For very poor quality invoices, manual entry may be faster

### Supplier Not Matched

**Problem:** Extracted supplier doesn't match any in your system

**Solutions:**
1. Check the suggested matches in the review modal
2. Verify GSTIN format (15 characters)
3. Create new supplier from extracted data
4. Add alias for future matching

### Items Not Matched

**Problem:** Extracted items don't match your catalog

**Solutions:**
1. Review item names and HSN/SAC codes
2. Select suggested matches from your catalog
3. Create new items from extracted data
4. Update item HSN/SAC codes for better future matching

### Service Not Running Error

**Error:** "Invoice extraction service is not running"

**Solution:**
1. Open a terminal
2. Navigate to project directory
3. Run: `scripts\start-invoice-service.bat`
4. Wait for "Starting Invoice Extraction Service" message
5. Try uploading again

## Limitations

### Current Limitations

- **File Size:** Maximum 10MB per file
- **Processing Time:** Up to 60 seconds per invoice
- **Simultaneous Processing:** 5 concurrent extractions
- **Languages:** English and Hindi (if configured)
- **Format Support:** Standard GST invoices work best

### Not Supported (Yet)

- Bulk invoice processing (multiple files at once)
- Handwritten invoices
- Invoices in regional languages (except Hindi)
- Automatic purchase creation without review
- Historical invoice import

## Privacy and Security

- Uploaded invoices are processed locally on your server
- No data is sent to third-party services
- Files are temporarily stored during processing
- Temporary files are deleted after extraction
- Extracted data is stored in your database only

## Getting Help

If you encounter issues:

1. **Check Service Status:**
   - Ensure Python service is running
   - Check service health at: http://127.0.0.1:5001/health

2. **Review Logs:**
   - Python service logs in the terminal
   - Browser console for frontend errors

3. **Contact Support:**
   - Report issues with sample invoices (remove sensitive data)
   - Include error messages and screenshots

## Advanced Features

### Creating Aliases

When a supplier is matched, you can create aliases for alternative names:

1. After accepting extracted data
2. System automatically learns variations
3. Future invoices with similar names will match

### Template Management

For administrators, custom templates can be created for:
- Specific vendor formats
- Industry-standard layouts
- Company-specific requirements

See [Template Guide](INVOICE_TEMPLATE_GUIDE.md) for details.

## Keyboard Shortcuts

In the review modal:
- **Enter:** Accept and fill form
- **Escape:** Close modal
- **Tab:** Navigate between fields

## Feedback

Help us improve:
- Report extraction errors
- Suggest feature improvements
- Share common invoice formats you encounter
- Request support for new document types

---

**Happy extracting!** Save time and reduce errors with automated invoice processing.
