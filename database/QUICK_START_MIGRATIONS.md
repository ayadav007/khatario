# Quick Start: Running GST Migrations

## 🚀 Fastest Method (Recommended)

### Using Node.js Script (All Platforms)

1. **Set your database connection** in `.env` file:
   ```bash
   DATABASE_URL=postgresql://username:password@localhost:5432/khatario
   ```
   Or set individual variables:
   ```bash
   DB_HOST=localhost
   DB_PORT=5432
   DB_NAME=khatario
   DB_USER=postgres
   DB_PASSWORD=your_password
   ```

2. **Run the script:**
   
   **Windows:**
   ```cmd
   scripts\run_gst_migrations.bat
   ```
   
   **Linux/Mac:**
   ```bash
   ./scripts/run_gst_migrations.sh
   ```
   
   **Or directly:**
   ```bash
   node scripts/run_gst_migrations.js
   ```

3. **Done!** The script will:
   - ✅ Run all 9 migrations in order
   - ✅ Show progress for each migration
   - ✅ Report success/failure
   - ✅ Track which migrations ran

---

## 📋 Alternative: Manual Execution

### Using pgAdmin (Easiest GUI Method)

1. Open **pgAdmin**
2. Connect to your database
3. Right-click database → **Query Tool**
4. Open each migration file from `database/migrations/` folder:
   - `001_phase1_invoice_items_gst_breakdown.sql`
   - `002_phase1_invoice_document_type.sql`
   - `003_phase1_customer_supplier_state_code.sql`
   - ... (continue with all 9 files in order)
5. Click **Execute** (F5) for each file

### Using psql Command Line

```bash
# Connect to database
psql -U your_username -d khatario

# Then run each migration (make sure you're in project root)
\i database/migrations/001_phase1_invoice_items_gst_breakdown.sql
\i database/migrations/002_phase1_invoice_document_type.sql
\i database/migrations/003_phase1_customer_supplier_state_code.sql
# ... continue with all 9 files
```

---

## ✅ Verify It Worked

Run this query in pgAdmin or psql:

```sql
-- Check if key fields exist
SELECT 
    'invoice_items' as table_name,
    COUNT(*) FILTER (WHERE column_name = 'cgst_amount') as has_cgst,
    COUNT(*) FILTER (WHERE column_name = 'sgst_amount') as has_sgst,
    COUNT(*) FILTER (WHERE column_name = 'igst_amount') as has_igst
FROM information_schema.columns 
WHERE table_name = 'invoice_items'

UNION ALL

SELECT 
    'invoices' as table_name,
    COUNT(*) FILTER (WHERE column_name = 'supply_type') as has_supply_type,
    COUNT(*) FILTER (WHERE column_name = 'document_type') as has_document_type,
    0 as has_igst
FROM information_schema.columns 
WHERE table_name = 'invoices';
```

Or run the full verification:
```sql
\i database/schema_verification_query.sql
```

---

## ❓ Troubleshooting

**"Cannot find module 'pg'"**
```bash
npm install pg
```

**"Connection refused"**
- Check PostgreSQL is running
- Verify database credentials in `.env`
- Check firewall/network settings

**"Permission denied"**
- Ensure database user has ALTER, CREATE, INSERT permissions
- You may need to run as database superuser

**"Column already exists"**
- ✅ This is OK! Migrations are safe to re-run
- The column already exists, skip or continue

---

## 📚 More Help

- **Detailed Guide:** `database/MIGRATION_GUIDE.md`
- **Implementation Details:** `database/GST_COMPLIANCE_IMPLEMENTATION.md`
- **Migration Files:** `database/migrations/README.md`

