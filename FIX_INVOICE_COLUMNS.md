# Fix: Missing Invoice Columns Error

## Problem
You're getting this error when saving invoices:
```
Error: column "cgst_total" of relation "invoices" does not exist
```

## Solution: Run Database Migration

The database is missing the new columns needed for the invoice workflow. Here's how to fix it:

---

## Option 1: Using pgAdmin (Recommended - Easiest)

### Step 1: Open pgAdmin
1. Open pgAdmin from Windows Start menu
2. Connect to your PostgreSQL server
3. Expand: **Servers** → **PostgreSQL** → **Databases** → **khatario**

### Step 2: Open Query Tool
1. Right-click on **khatario** database
2. Click **Query Tool** (or press `Alt+Shift+Q`)

### Step 3: Run Migration Script
1. In the Query Tool, click the **folder icon** (Open File)
2. Navigate to: `D:\MyApps\Khatario\database\add_invoice_status_fields.sql`
3. Click **Open**
4. Click **Execute** button (or press `F5`)
5. Wait for "Success" message

### Step 4: Verify
You should see a result showing 5 rows with these columns:
- `is_editable`
- `cancellation_details`
- `cgst_total`
- `sgst_total`
- `igst_total`

---

## Option 2: Using Command Line (psql)

Open PowerShell or Command Prompt and run:

```bash
psql -U postgres -d khatario -f database/add_invoice_status_fields.sql
```

Enter your PostgreSQL password when prompted.

---

## Option 3: Manual SQL (If files don't work)

Copy and paste this SQL into pgAdmin Query Tool:

```sql
BEGIN;

-- Add is_editable if missing
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'invoices' AND column_name = 'is_editable'
  ) THEN
    ALTER TABLE invoices ADD COLUMN is_editable BOOLEAN DEFAULT true;
  END IF;
END$$;

-- Add cancellation_details if missing
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'invoices' AND column_name = 'cancellation_details'
  ) THEN
    ALTER TABLE invoices ADD COLUMN cancellation_details JSONB DEFAULT NULL;
  END IF;
END$$;

-- Add cgst_total if missing
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'invoices' AND column_name = 'cgst_total'
  ) THEN
    ALTER TABLE invoices ADD COLUMN cgst_total DECIMAL(12,2) DEFAULT 0;
  END IF;
END$$;

-- Add sgst_total if missing
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'invoices' AND column_name = 'sgst_total'
  ) THEN
    ALTER TABLE invoices ADD COLUMN sgst_total DECIMAL(12,2) DEFAULT 0;
  END IF;
END$$;

-- Add igst_total if missing
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'invoices' AND column_name = 'igst_total'
  ) THEN
    ALTER TABLE invoices ADD COLUMN igst_total DECIMAL(12,2) DEFAULT 0;
  END IF;
END$$;

-- Update existing rows
UPDATE invoices SET is_editable = true WHERE is_editable IS NULL;
UPDATE invoices SET cgst_total = 0 WHERE cgst_total IS NULL;
UPDATE invoices SET sgst_total = 0 WHERE sgst_total IS NULL;
UPDATE invoices SET igst_total = 0 WHERE igst_total IS NULL;

COMMIT;
```

---

## What This Does

This migration adds 5 new columns to the `invoices` table:
1. **`is_editable`** - Boolean flag to lock/unlock invoice editing
2. **`cancellation_details`** - JSONB field to store cancellation reason and details
3. **`cgst_total`** - CGST tax total for GST compliance
4. **`sgst_total`** - SGST tax total for GST compliance
5. **`igst_total`** - IGST tax total for GST compliance

It also updates any existing invoices with default values.

---

## After Running Migration

1. **Refresh your browser** (if app is running)
2. **Try creating an invoice again**
3. The error should be gone!

---

## Verify It Worked

Run this query in pgAdmin to check:

```sql
SELECT column_name, data_type 
FROM information_schema.columns
WHERE table_name = 'invoices'
  AND column_name IN ('is_editable', 'cancellation_details', 'cgst_total', 'sgst_total', 'igst_total')
ORDER BY column_name;
```

You should see all 5 columns listed.


