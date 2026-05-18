# GST Compliance Migrations - Step-by-Step Guide

This guide will help you run the GST compliance migrations on your database.

## Prerequisites

- PostgreSQL database running
- Database connection credentials
- Access to run SQL commands

---

## Method 1: Using Node.js Script (Recommended)

### Step 1: Install Dependencies

Ensure you have `pg` (PostgreSQL client) installed:

```bash
npm install pg
```

### Step 2: Set Environment Variables

Create a `.env` file in your project root (if not already exists) or set environment variables:

```bash
# Option 1: Using DATABASE_URL (recommended)
DATABASE_URL=postgresql://username:password@localhost:5432/khatario

# Option 2: Using individual variables
DB_HOST=localhost
DB_PORT=5432
DB_NAME=khatario
DB_USER=postgres
DB_PASSWORD=your_password
```

### Step 3: Run the Migration Script

```bash
node scripts/run_gst_migrations.js
```

The script will:
- ✅ Run all migrations in order
- ✅ Log progress and errors
- ✅ Track which migrations have been executed
- ✅ Continue even if one migration fails (so you can fix and re-run)

### Step 4: Verify Results

The script will show you:
- Which migrations succeeded ✅
- Which migrations failed ❌
- Summary of results

---

## Method 2: Using pgAdmin (GUI)

### Step 1: Open pgAdmin

1. Launch pgAdmin
2. Connect to your PostgreSQL server
3. Expand your database (e.g., `khatario`)

### Step 2: Open Query Tool

1. Right-click on your database
2. Select **Query Tool**

### Step 3: Run Migrations One by One

For each migration file in order (001 through 009):

1. Click **Open File** button (folder icon)
2. Navigate to `database/migrations/`
3. Select the migration file (e.g., `001_phase1_invoice_items_gst_breakdown.sql`)
4. Click **Execute** (F5) or click the play button
5. Wait for "Success" message
6. Repeat for next migration file

**Migration Files (in order):**
```
001_phase1_invoice_items_gst_breakdown.sql
002_phase1_invoice_document_type.sql
003_phase1_customer_supplier_state_code.sql
004_phase1_credit_notes_gst_fields.sql
005_phase1_debit_notes_table.sql
006_phase2_purchases_gst_fields.sql
007_phase2_purchase_items_gst_breakdown.sql
008_phase3_advance_payments_table.sql
009_phase3_itc_reversals_table.sql
```

### Step 4: Verify Schema

Run the verification query:

1. Open `database/schema_verification_query.sql` in Query Tool
2. Execute it
3. Review the results to confirm all fields are present

---

## Method 3: Using psql (Command Line)

### Step 1: Connect to Database

```bash
psql -U your_username -d khatario
```

Enter your password when prompted.

### Step 2: Run Migrations

Run each migration file in order:

```bash
\i database/migrations/001_phase1_invoice_items_gst_breakdown.sql
\i database/migrations/002_phase1_invoice_document_type.sql
\i database/migrations/003_phase1_customer_supplier_state_code.sql
\i database/migrations/004_phase1_credit_notes_gst_fields.sql
\i database/migrations/005_phase1_debit_notes_table.sql
\i database/migrations/006_phase2_purchases_gst_fields.sql
\i database/migrations/007_phase2_purchase_items_gst_breakdown.sql
\i database/migrations/008_phase3_advance_payments_table.sql
\i database/migrations/009_phase3_itc_reversals_table.sql
```

**Note:** Make sure you're in the project root directory when running `\i` commands, or use absolute paths.

### Step 3: Verify

```bash
\i database/schema_verification_query.sql
```

---

## Verification

After running migrations, verify everything is correct:

### Option 1: Run Verification Query

Execute `database/schema_verification_query.sql` in your SQL client. It will show:
- ✅ Which GST fields exist in each table
- ✅ Whether new tables were created
- ✅ Summary of GST-related columns

### Option 2: Quick Manual Check

Run these queries to verify key fields:

```sql
-- Check invoice_items has GST breakdown
SELECT column_name FROM information_schema.columns 
WHERE table_name = 'invoice_items' 
AND column_name IN ('cgst_amount', 'sgst_amount', 'igst_amount', 'taxable_value');

-- Check invoices has document type fields
SELECT column_name FROM information_schema.columns 
WHERE table_name = 'invoices' 
AND column_name IN ('supply_type', 'document_type', 'export_type');

-- Check new tables exist
SELECT table_name FROM information_schema.tables 
WHERE table_name IN ('debit_notes', 'advance_payments', 'itc_reversals');
```

---

## Troubleshooting

### Error: "column already exists"

✅ **This is OK!** Migrations are idempotent. The column already exists, which means this migration was partially run before. You can safely skip it or let it continue.

### Error: "relation does not exist"

⚠️ **Check dependencies:** Make sure you're running migrations in order. Each migration may depend on previous ones.

### Error: Permission denied

🔐 **Fix:** Ensure your database user has CREATE, ALTER, and INSERT permissions.

```sql
-- Grant permissions (run as superuser)
GRANT ALL PRIVILEGES ON DATABASE khatario TO your_username;
```

### Error: Connection refused

🔌 **Fix:** Check your database connection settings:
- Is PostgreSQL running?
- Is the port correct? (default: 5432)
- Are firewall rules blocking the connection?

---

## What Gets Changed?

### New Columns Added

**invoices:**
- `document_type`, `supply_type`, `export_type`
- `shipping_bill_number`, `shipping_bill_date`, `port_code`
- `ecommerce_operator_gstin`, `is_ecommerce_supply`

**invoice_items:**
- `cgst_amount`, `sgst_amount`, `igst_amount`, `taxable_value`

**customers & suppliers:**
- `state_code`

**purchases:**
- `cgst_total`, `sgst_total`, `igst_total`
- `place_of_supply_state_code`, `is_reverse_charge`
- `supplier_gstin`, `document_type`
- `itc_eligible`, `itc_availed`, `itc_availed_date`

**purchase_items:**
- `hsn_sac`, `discount_percent`, `discount_amount`
- `taxable_value`, `tax_amount`
- `cgst_amount`, `sgst_amount`, `igst_amount`

**credit_notes:**
- `cgst_total`, `sgst_total`, `igst_total`
- `place_of_supply_state_code`, `original_invoice_date`

### New Tables Created

- `debit_notes` - Sales-side adjustments
- `debit_note_items` - Line items for debit notes
- `advance_payments` - Advances received/paid
- `itc_reversals` - ITC reversal tracking
- `gst_migrations_log` - Migration tracking (created by script)

---

## After Migration

1. ✅ **Verify schema** - Run verification query
2. ✅ **Test invoice creation** - Create a test invoice and verify GST breakdown is stored
3. ✅ **Review backfilled data** - Check existing records for calculated values
4. ✅ **Update frontend** - Add UI fields for new data (state codes, export details, etc.)

---

## Need Help?

- Check `database/GST_COMPLIANCE_IMPLEMENTATION.md` for detailed implementation notes
- Review migration files in `database/migrations/` for detailed comments
- Check `gst_migrations_log` table to see which migrations ran successfully

