# Invoice Template Creation Guide

Learn how to create custom templates for better invoice extraction accuracy with recurring vendors.

## What are Templates?

Templates are YAML files that define patterns (regex) for extracting specific fields from invoices. They help the system understand different invoice layouts and formats.

**Benefits:**
- Higher extraction accuracy for specific vendors
- Faster processing (template matching is quicker than generic extraction)
- Support for unique invoice formats
- Customizable for your business needs

## When to Create a Template

Create a custom template when:
- You regularly receive invoices from the same vendor
- The vendor has a consistent invoice format
- Generic extraction doesn't work well for this vendor
- You process many invoices from this vendor (ROI on template creation time)

## Template Structure

Templates are written in YAML format with this structure:

```yaml
issuer: 'Vendor Name or Pattern'
keywords:
  - keyword1
  - keyword2
fields:
  field_name:
    - 'regex pattern 1'
    - 'regex pattern 2'
  another_field:
    - 'regex pattern'
options:
  currency: INR
  date_formats:
    - '%d/%m/%Y'
```

## Basic Template Example

Here's a simple template for a GST invoice:

```yaml
issuer: 'ABC Suppliers Pvt Ltd'
keywords:
  - 'GST'
  - 'Tax Invoice'
fields:
  invoice_number:
    - 'Invoice No[.:\s]+([A-Z0-9\-/]+)'
  date:
    - 'Date[.:\s]+(\d{1,2}[./-]\d{1,2}[./-]\d{2,4})'
  gstin:
    - 'GSTIN[.:\s]+([0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1})'
  amount:
    - 'Grand Total[.:\s]+(?:Rs\.?|INR|₹)?\s*([\d,]+\.?\d*)'
options:
  currency: INR
  date_formats:
    - '%d/%m/%Y'
    - '%d-%m-%Y'
```

## Field Types

### Required Fields

**invoice_number** - Invoice or bill number
```yaml
invoice_number:
  - 'Invoice\s*(?:No|Number|#)[:\s]+([A-Z0-9\-/]+)'
  - 'Bill\s*No[:\s]+([A-Z0-9\-/]+)'
```

**date** - Invoice date
```yaml
date:
  - 'Date[:\s]+(\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4})'
  - 'Invoice\s*Date[:\s]+(\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4})'
```

**issuer** - Vendor/Supplier name (automatically set from template name, or extracted)
```yaml
issuer:
  - '^([A-Z][^\n]+(?:Pvt\.?|Ltd\.?)[^\n]*)'
```

### Common Fields

**GSTIN** - GST Identification Number
```yaml
gstin:
  - 'GSTIN[:\s]+([0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1})'
```

**Amount** - Grand total
```yaml
amount:
  - 'Grand\s*Total[:\s]+(?:Rs\.?|INR|₹)?\s*([\d,]+\.?\d*)'
  - 'Total\s*Amount[:\s]+(?:Rs\.?|INR|₹)?\s*([\d,]+\.?\d*)'
```

**Subtotal** - Amount before tax
```yaml
subtotal:
  - 'Subtotal[:\s]+(?:Rs\.?|INR|₹)?\s*([\d,]+\.?\d*)'
  - 'Taxable\s*Amount[:\s]+(?:Rs\.?|INR|₹)?\s*([\d,]+\.?\d*)'
```

**Tax Amounts**
```yaml
cgst:
  - 'CGST[:\s@]+.*?([\d,]+\.?\d*)'
sgst:
  - 'SGST[:\s@]+.*?([\d,]+\.?\d*)'
igst:
  - 'IGST[:\s@]+.*?([\d,]+\.?\d*)'
```

### Optional Fields

**Address**
```yaml
supplier_address:
  - 'Address[:\s]+([^\n]+(?:\n[^\n]+){0,2})'
```

**Email**
```yaml
email:
  - '([a-zA-Z0-9._%-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})'
```

**Phone**
```yaml
phone:
  - '(?:Phone|Tel|Mobile)[:\s]+(\+?\d[\d\s\-()]+)'
```

## Regex Patterns Guide

### Common Patterns

**Numbers:**
```regex
\d+           # One or more digits
\d{4}         # Exactly 4 digits
\d{1,2}       # 1 or 2 digits
[\d,]+\.?\d*  # Number with commas and optional decimal
```

**Text:**
```regex
[A-Z]+        # One or more uppercase letters
[A-Za-z]+     # One or more letters
[^\n]+        # Everything except newline
.+            # One or more of any character
```

**Whitespace:**
```regex
\s+           # One or more whitespace
\s*           # Zero or more whitespace
[:\s]+        # Colon or whitespace
```

**Optional:**
```regex
pattern?      # 0 or 1 occurrence
pattern*      # 0 or more occurrences
pattern+      # 1 or more occurrences
```

**Groups:**
```regex
(pattern)     # Capture group (this is what gets extracted)
(?:pattern)   # Non-capturing group
```

### Indian GST Invoice Patterns

**GSTIN Format:**
```regex
[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}
# Breakdown:
# [0-9]{2}              - State code (2 digits)
# [A-Z]{5}              - PAN prefix (5 letters)
# [0-9]{4}              - PAN number (4 digits)
# [A-Z]{1}              - PAN suffix (1 letter)
# [1-9A-Z]{1}           - Entity number
# Z                     - Literal Z
# [0-9A-Z]{1}           - Check digit
```

**HSN/SAC Code:**
```regex
(?:HSN|SAC)[:\s]+(\d{4,8})
# Matches: HSN: 1234, SAC: 123456, etc.
```

**Currency Amounts:**
```regex
(?:Rs\.?|INR|₹)?\s*([\d,]+\.?\d*)
# Matches: Rs. 1,234.56, INR 1234, ₹1234.50, 1234
```

## Testing Your Template

### Method 1: Python Service Test Endpoint

```bash
curl -X POST -F "file=@sample_invoice.pdf" http://127.0.0.1:5001/extract
```

### Method 2: Template Test in App

1. Save your template to: `invoice-extraction-service/templates/your_vendor.yml`
2. Restart the Python service
3. Upload a sample invoice from that vendor
4. Check extracted data for accuracy

### Method 3: Direct Template Testing

```python
from invoice2data import extract_data
from invoice2data.extract.loader import read_templates

templates = read_templates('./templates')
result = extract_data('sample_invoice.pdf', templates=templates)
print(result)
```

## Advanced Features

### Multiple Patterns per Field

Provide multiple patterns to handle variations:

```yaml
invoice_number:
  - 'Invoice No[:\s]+([A-Z0-9\-/]+)'
  - 'Bill No[:\s]+([A-Z0-9\-/]+)'
  - 'Inv\.?\s*#\s*([A-Z0-9\-/]+)'
```

The first matching pattern will be used.

### Line Items Extraction

For extracting multiple line items from a table:

```yaml
fields:
  lines:
    start: 'Description'
    end: 'Total'
    line: '(.*?)\s+(\d+)\s+([\d,]+\.?\d*)\s+([\d.]+)%'
    types:
      - string    # Item description
      - int       # Quantity
      - float     # Unit price
      - float     # Tax rate
```

### Conditional Extraction

Extract different fields based on document type:

```yaml
fields:
  document_type:
    - 'Tax Invoice'
    - 'Bill of Supply'
  # If Tax Invoice, extract GST
  gstin:
    - 'GSTIN[:\s]+([0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1})'
    required_for: 'Tax Invoice'
```

## Template Management in App

### Adding Templates via UI

1. Go to **Settings > Invoice Templates** (Admin only)
2. Click **"New Template"**
3. Fill in:
   - Template name
   - Vendor pattern (for auto-selection)
   - YAML content
4. Save template

### Template Auto-Selection

The system automatically selects templates based on:
1. Vendor pattern match
2. Keyword presence
3. Success history

### Template Performance Tracking

Each template tracks:
- Usage count (how many times used)
- Success count (successful extractions)
- Last used date
- Accuracy score

## Best Practices

### 1. Start Simple

Begin with basic fields and add complexity gradually:

```yaml
# Start with these
invoice_number
date
amount

# Then add
gstin
subtotal
taxes

# Finally add
line items
complex patterns
```

### 2. Test with Multiple Invoices

Test your template with at least 5-10 invoices from the same vendor to ensure it handles variations.

### 3. Use Specific Patterns

Prefer specific patterns over generic ones:

**Good:**
```yaml
invoice_number:
  - 'Invoice No[.:\s]+([A-Z]{3}-\d{4})'  # Specific format
```

**Avoid:**
```yaml
invoice_number:
  - '([A-Z0-9]+)'  # Too generic
```

### 4. Handle Edge Cases

Consider invoices with:
- Multiple pages
- Different formats (draft vs final)
- Amended/revised invoices
- Credit notes vs invoices

### 5. Document Your Templates

Add comments in YAML:

```yaml
# Template for ABC Suppliers
# Format: INV-YYYY-NNNN
# Updated: 2024-01-15
# Notes: Handles both tax invoices and bills of supply
```

## Common Issues

### Issue: Pattern Not Matching

**Problem:** Field not extracted

**Debug:**
1. Get raw OCR text: Use `/test` endpoint
2. Check if pattern appears in text
3. Adjust regex to match actual format
4. Test with online regex tester (regex101.com)

### Issue: Wrong Value Extracted

**Problem:** Extracts wrong part of text

**Solution:**
1. Make pattern more specific
2. Use anchors (^, $) for line boundaries
3. Use lookahead/lookbehind assertions

### Issue: Template Not Being Used

**Problem:** Generic extraction used instead

**Check:**
1. Template issuer name matches vendor
2. Keywords appear in invoice
3. Template file is in correct directory
4. Python service restarted after adding template

## Template Library

Example templates for common scenarios are available in:
`invoice-extraction-service/templates/`

- `generic_indian_gst.yml` - Fallback for any GST invoice
- `amazon_invoice.yml` - Amazon business invoices (example)
- `flipkart_seller.yml` - Flipkart seller invoices (example)

## Contributing Templates

Share your templates with the community:
1. Test thoroughly
2. Remove business-specific information
3. Add clear comments
4. Submit via GitHub or support

---

**Need help?** Post your sample invoice (with sensitive data removed) and we'll help create a template!
