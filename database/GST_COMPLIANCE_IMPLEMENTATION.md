# GST Compliance Implementation - Complete Guide

## Overview

This document describes the complete GST compliance implementation for Khatario, enabling generation of GSTR-1, GSTR-2/2B, and GSTR-3B reports.

## Implementation Status

✅ **All database migrations created**
✅ **Schema updated**
✅ **Invoice API updated with GST breakdown**
🔄 **Purchase API updates (in progress)**
⏳ **GST Report APIs (to be created)**

## Migration Files

All migration files are located in `database/migrations/`:

1. **001_phase1_invoice_items_gst_breakdown.sql** - Adds line-item GST breakdown
2. **002_phase1_invoice_document_type.sql** - Adds document type classification
3. **003_phase1_customer_supplier_state_code.sql** - Adds state codes
4. **004_phase1_credit_notes_gst_fields.sql** - Enhances credit notes
5. **005_phase1_debit_notes_table.sql** - Creates debit notes table
6. **006_phase2_purchases_gst_fields.sql** - Enhances purchases table
7. **007_phase2_purchase_items_gst_breakdown.sql** - Enhances purchase items
8. **008_phase3_advance_payments_table.sql** - Creates advance payments table
9. **009_phase3_itc_reversals_table.sql** - Creates ITC reversals table

## How to Apply Migrations

### Option 1: Run Individual Migrations (Recommended for Testing)

```bash
# Connect to PostgreSQL
psql -U your_user -d your_database

# Run migrations in order
\i database/migrations/001_phase1_invoice_items_gst_breakdown.sql
\i database/migrations/002_phase1_invoice_document_type.sql
# ... continue with remaining migrations
```

### Option 2: Run All Migrations at Once

```bash
psql -U your_user -d your_database -f database/migrations/000_run_all_gst_migrations.sql
```

### Option 3: Use pgAdmin

1. Open pgAdmin
2. Connect to your database
3. Right-click on database → Query Tool
4. Open and execute each migration file in order (001 through 009)

## Schema Verification

After running migrations, verify all fields are present:

```sql
\i database/schema_verification_query.sql
```

Or run the query directly in pgAdmin to see a comprehensive report of all GST-related fields.

## Key Changes

### Invoice Items
- ✅ Added `cgst_amount`, `sgst_amount`, `igst_amount` per line item
- ✅ Added `taxable_value` (after discount, before tax)

### Invoices
- ✅ Added `document_type`, `supply_type`, `export_type`
- ✅ Added export fields: `shipping_bill_number`, `shipping_bill_date`, `port_code`
- ✅ Added e-commerce fields: `ecommerce_operator_gstin`, `is_ecommerce_supply`

### Customers & Suppliers
- ✅ Added `state_code` (2-digit GST state code)

### Purchases
- ✅ Added GST totals: `cgst_total`, `sgst_total`, `igst_total`
- ✅ Added `place_of_supply_state_code`, `is_reverse_charge`
- ✅ Added `supplier_gstin`, `document_type`
- ✅ Added ITC tracking: `itc_eligible`, `itc_availed`, `itc_availed_date`

### Purchase Items
- ✅ Added `hsn_sac`, discount fields, GST breakdown
- ✅ Added `taxable_value`

### Credit Notes
- ✅ Added GST totals: `cgst_total`, `sgst_total`, `igst_total`
- ✅ Added `place_of_supply_state_code`, `original_invoice_date`

### New Tables
- ✅ `debit_notes` - For sales-side adjustments
- ✅ `debit_note_items` - Line items for debit notes
- ✅ `advance_payments` - For advances received/paid
- ✅ `itc_reversals` - For ITC reversal tracking

## API Changes

### Invoice Creation API (`POST /api/invoices`)

**New Fields Accepted:**
- `document_type` - Document type classification
- `supply_type` - Auto-classified if not provided (b2b, b2c_large, b2c_small, export, sez)
- `export_type` - For exports (wop, wp)
- `shipping_bill_number`, `shipping_bill_date`, `port_code` - Export details
- `ecommerce_operator_gstin`, `is_ecommerce_supply` - E-commerce fields

**Enhanced Behavior:**
- Automatically calculates and stores line-item GST breakdown (CGST/SGST/IGST)
- Auto-classifies `supply_type` based on customer GSTIN, invoice value, and POS
- Stores `taxable_value` for each line item

## Next Steps

1. ✅ Run database migrations
2. ✅ Verify schema using verification query
3. 🔄 Update Purchase API to calculate GST breakdown (similar to Invoice API)
4. ⏳ Create GST Report APIs:
   - `GET /api/reports/gst/gstr1` - GSTR-1 generation
   - `GET /api/reports/gst/gstr2` - GSTR-2/2B generation
   - `GET /api/reports/gst/gstr3b` - GSTR-3B summary
5. ⏳ Update frontend to capture new fields (state codes, export details, etc.)
6. ⏳ Test with sample data

## Data Backfilling

All migrations include backfilling logic to populate existing records:

- **Invoice Items**: Calculates GST breakdown from invoice-level totals
- **Invoices**: Auto-classifies supply_type for existing invoices
- **Customers/Suppliers**: Attempts to map state names to state codes
- **Credit Notes**: Calculates GST breakdown from linked invoices

**Note:** Review and verify backfilled data. Some fields may require manual correction.

## Support

For issues or questions:
1. Check `database/schema_verification_query.sql` results
2. Review migration files for detailed comments
3. Ensure all migrations ran successfully (check for errors)

