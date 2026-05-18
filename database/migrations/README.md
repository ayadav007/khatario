# GST Compliance Migrations

This directory contains all database migrations for GST compliance implementation.

## Migration Order

Run migrations in numerical order (001 through 010):

1. **001_phase1_invoice_items_gst_breakdown.sql**
2. **002_phase1_invoice_document_type.sql**
3. **003_phase1_customer_supplier_state_code.sql**
4. **004_phase1_credit_notes_gst_fields.sql**
5. **005_phase1_debit_notes_table.sql**
6. **006_phase2_purchases_gst_fields.sql**
7. **007_phase2_purchase_items_gst_breakdown.sql**
8. **008_phase3_advance_payments_table.sql**
9. **009_phase3_itc_reversals_table.sql**
10. **010_hsn_sac_master_table.sql** - HSN/SAC code lookup table

## Quick Start

### Using psql:
```bash
psql -U your_user -d your_database -f database/migrations/001_phase1_invoice_items_gst_breakdown.sql
# Repeat for each migration file
```

### Using pgAdmin:
1. Open Query Tool
2. Open migration file
3. Execute
4. Repeat for all files in order

## Verification

After running all migrations, verify with:
```sql
\i database/schema_verification_query.sql
```

## HSN/SAC Master Table

The `010_hsn_sac_master_table.sql` migration creates a lookup table for HSN/SAC codes with:
- Code and description
- GST rates
- Categories and keywords
- Full-text search support

This enables automatic HSN/SAC code lookup when adding products.

To add more codes, you can:
1. Import from CSV (see sample format below)
2. Insert manually via SQL
3. Update via API (future enhancement)

### Sample CSV Import Format:
```csv
code,description,gst_rate,category,is_service,keywords
19053100,Biscuits and similar baked products,5,Food & Beverages,false,"biscuit,cookie,snack"
998314,Software development services,18,IT Services,true,"software,development,IT"
```

## Notes

- All migrations are idempotent (safe to run multiple times)
- Existing data is backfilled where possible
- All new fields have DEFAULT values for backward compatibility
