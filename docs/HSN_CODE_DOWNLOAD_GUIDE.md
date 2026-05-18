# HSN/SAC Code Download and Import Guide

This guide explains how to download the latest HSN/SAC codes and import them into your Khatario database.

## 🚀 Quick Start

### Step 1: Run the Migration (If Not Done)

First, ensure the `hsn_sac_master` table exists:

**Using pgAdmin:**
1. Open pgAdmin
2. Connect to your database
3. Right-click database → **Query Tool**
4. Open file: `database/migrations/010_hsn_sac_master_table.sql`
5. Click **Execute** (F5)

**Or using command line:**
```bash
psql -U postgres -d khatario -f database/migrations/010_hsn_sac_master_table.sql
```

### Step 2: Import Sample Codes

A sample CSV file with common codes is included:

```bash
node scripts/import_hsn_codes.js data/hsn_codes_sample.csv
```

This will import 24 common HSN/SAC codes for testing.

---

## 📥 Downloading HSN/SAC Codes

### Option 1: Official Government Sources (Recommended)

#### A. GST Portal
1. Visit: https://www.gst.gov.in/
2. Go to **Services** → **User Services** → **HSN/SAC Codes**
3. Download the Excel/CSV file
4. Note: You may need to clean/format the data

#### B. CBIC (Central Board of Indirect Taxes and Customs)
1. Visit: https://www.cbic.gov.in/
2. Navigate to **GST** section
3. Look for HSN code lists/downloads
4. Download the latest version

### Option 2: Free Community Resources

#### A. GitHub Repositories
Search GitHub for "HSN code master" or "GST HSN database":
- Many open-source CSV/JSON files available
- Example searches:
  - `HSN code India CSV`
  - `GST HSN master data`
  - `Indian HSN SAC codes`

#### B. Free Tools (Data Extraction)
1. **Tally Solutions HSN Finder**
   - Visit: https://www.tallysolutions.com/business-tools-templates/free-hsn-code-finder/
   - Use for reference (not direct download)

2. **ClearTax HSN Lookup**
   - Visit: https://cleartax.in/s/gst-hsn-lookup
   - Use browser tools to extract data (if permitted by ToS)

### Option 3: Create Your Own Dataset

For your specific business needs, you can:

1. **Start with common codes** (already included in sample CSV)
2. **Add codes as you need them** (manual entry)
3. **Build gradually** based on your products/services

---

## 📋 CSV Format Required

Your CSV file must follow this format:

```csv
code,description,gst_rate,category,is_service,keywords
19053100,Biscuits and similar baked products,5,Food & Beverages,false,"biscuit,cookie,snack"
998314,Software development services,18,IT Services,true,"software,development,IT"
```

### Column Descriptions:

| Column | Required | Description | Example |
|--------|----------|-------------|---------|
| `code` | ✅ Yes | HSN (8 digits) or SAC (6 digits) code | `19053100` or `998314` |
| `description` | ✅ Yes | Product/service description | `Biscuits and similar baked products` |
| `gst_rate` | No | GST rate percentage | `5`, `12`, `18`, `28` |
| `category` | No | Category name | `Food & Beverages` |
| `is_service` | No | `true` for SAC, `false` for HSN | `false` or `true` |
| `keywords` | No | Comma-separated search keywords | `"biscuit,cookie,snack"` |

### Notes:
- **Keywords**: Use quotes if containing commas: `"biscuit,cookie,snack"`
- **is_service**: Use `true`/`false` or `1`/`0`
- **gst_rate**: Can be decimal (e.g., `5.5`) or whole number

---

## 💾 Importing Codes to Database

### Method 1: Using the Import Script (Recommended)

```bash
node scripts/import_hsn_codes.js <path_to_your_csv_file>
```

**Example:**
```bash
# Import sample codes
node scripts/import_hsn_codes.js data/hsn_codes_sample.csv

# Import your downloaded file
node scripts/import_hsn_codes.js downloads/hsn_master_data.csv
```

**What the script does:**
- ✅ Validates CSV format
- ✅ Parses all rows
- ✅ Inserts new codes
- ✅ Updates existing codes (if code already exists)
- ✅ Shows progress and summary
- ✅ Handles errors gracefully

### Method 2: Manual SQL Import

#### Using pgAdmin:
1. Prepare your CSV file
2. Right-click database → **Query Tool**
3. Use COPY command:

```sql
COPY hsn_sac_master (code, description, gst_rate, category, is_service, keywords)
FROM 'C:/path/to/your/file.csv'
WITH (FORMAT csv, HEADER true, DELIMITER ',');
```

**Note:** Path must be accessible by PostgreSQL server.

#### Using psql:
```bash
psql -U postgres -d khatario -c "
COPY hsn_sac_master (code, description, gst_rate, category, is_service, keywords)
FROM STDIN WITH (FORMAT csv, HEADER true, DELIMITER ',');
" < your_file.csv
```

### Method 3: Manual INSERT Statements

For small datasets, you can insert manually:

```sql
INSERT INTO hsn_sac_master (code, description, gst_rate, category, is_service, keywords)
VALUES 
  ('19053100', 'Biscuits and similar baked products', 5.00, 'Food & Beverages', false, ARRAY['biscuit', 'cookie']),
  ('998314', 'Software development services', 18.00, 'IT Services', true, ARRAY['software', 'development'])
ON CONFLICT (code) DO UPDATE SET
  description = EXCLUDED.description,
  gst_rate = EXCLUDED.gst_rate;
```

---

## 🔄 Converting Downloaded Files

### From Excel to CSV

1. Open Excel file
2. Ensure columns match required format:
   - Rename columns if needed
   - Add missing columns (e.g., `keywords`, `category`)
3. Save as CSV:
   - File → Save As
   - Choose "CSV (Comma delimited) (*.csv)"
   - Save

### From Official Government Format

Government files may have different formats. You may need to:

1. **Clean the data:**
   - Remove headers/footers
   - Standardize column names
   - Remove empty rows

2. **Transform columns:**
   - Map to required columns
   - Add `is_service` column (SAC = true, HSN = false)
   - Create `keywords` from descriptions

3. **Sample transformation script** (if needed):
```javascript
// Convert government format to our format
const fs = require('fs');
const csv = require('csv-parser');

// Read, transform, write
// (Implementation depends on source format)
```

---

## ✅ Verification

After importing, verify the data:

```sql
-- Check total count
SELECT COUNT(*) FROM hsn_sac_master;

-- Check sample data
SELECT code, description, gst_rate, category 
FROM hsn_sac_master 
LIMIT 10;

-- Check by type
SELECT 
  is_service,
  COUNT(*) as count
FROM hsn_sac_master
GROUP BY is_service;

-- Test search
SELECT code, description, gst_rate
FROM hsn_sac_master
WHERE description ILIKE '%biscuit%'
   OR 'biscuit' = ANY(keywords);
```

**Test in the UI:**
1. Go to Items → Add New Item
2. Type "biscuit" in HSN/SAC Code field
3. Verify suggestions appear

---

## 🔄 Regular Updates

### When to Update:
- **Quarterly**: Check for GST rate changes
- **Semi-annually**: Check for new codes
- **As needed**: Add codes for new products/services

### Update Process:

1. **Backup current data:**
   ```sql
   COPY (SELECT * FROM hsn_sac_master) 
   TO '/path/to/backup.csv' 
   WITH CSV HEADER;
   ```

2. **Download latest codes** from official sources

3. **Import new data:**
   ```bash
   node scripts/import_hsn_codes.js latest_hsn_codes.csv
   ```

4. **Verify changes:**
   ```sql
   SELECT code, gst_rate, updated_at 
   FROM hsn_sac_master 
   WHERE updated_at > CURRENT_DATE - INTERVAL '7 days'
   ORDER BY updated_at DESC;
   ```

---

## 🛠️ Troubleshooting

### "No HSN/SAC codes found"

1. **Check if table exists:**
   ```sql
   SELECT EXISTS (
     SELECT FROM information_schema.tables 
     WHERE table_name = 'hsn_sac_master'
   );
   ```

2. **Check if data exists:**
   ```sql
   SELECT COUNT(*) FROM hsn_sac_master;
   ```

3. **Run migration if table missing:**
   ```bash
   psql -U postgres -d khatario -f database/migrations/010_hsn_sac_master_table.sql
   ```

### Import Errors

1. **Check CSV format:**
   - Ensure comma-separated
   - Check for proper quotes
   - Verify column names match exactly

2. **Check file encoding:**
   - Use UTF-8 encoding
   - Remove BOM if present

3. **Check database connection:**
   - Verify `.env` file settings
   - Test connection: `node -e "require('./lib/db').testConnection().then(console.log)"`

### Performance Issues

1. **Check indexes:**
   ```sql
   \d+ hsn_sac_master
   ```
   Should show indexes on `code`, `description`, `keywords`

2. **Optimize keywords:**
   - Add relevant keywords for better search
   - Use lowercase keywords

---

## 📚 Additional Resources

- **GST Portal**: https://www.gst.gov.in/
- **CBIC Website**: https://www.cbic.gov.in/
- **Tally HSN Finder**: https://www.tallysolutions.com/business-tools-templates/free-hsn-code-finder/
- **ClearTax HSN Lookup**: https://cleartax.in/s/gst-hsn-lookup

---

## 💡 Tips

1. **Start Small**: Import common codes for your industry first
2. **Build Gradually**: Add codes as you encounter new products
3. **Maintain Keywords**: Good keywords = better search results
4. **Regular Updates**: Keep GST rates current
5. **Backup**: Always backup before bulk updates

---

Need help? Check the main documentation: `docs/HSN_SAC_LOOKUP_GUIDE.md`

