# Database Schema Fixes

## Critical Issues Fixed

This document explains the fixes applied to address critical schema issues identified in the code review.

---

## 🔴 Critical Fixes (Must Apply)

### 1. Invoice Number Uniqueness - FIXED ✅

**Problem:** Invoice numbers were globally unique, preventing multiple businesses from using the same invoice number.

**Fix:** Changed to unique per business using composite index:
```sql
CREATE UNIQUE INDEX idx_invoices_business_invoice_number
ON invoices(business_id, invoice_number);
```

**Impact:** Now each business can have their own invoice numbering sequence (INV-001, INV-002, etc.)

---

### 2. Missing updated_at Triggers - FIXED ✅

**Problem:** Several tables had `updated_at` columns but no triggers to auto-update them.

**Fix:** Added triggers for:
- `suppliers`
- `whatsapp_config`
- `invoice_template_settings`
- `whatsapp_reminder_settings`
- `expense_categories`

**Impact:** These tables will now automatically update their `updated_at` timestamp on changes.

---

### 3. WhatsApp Config Uniqueness - FIXED ✅

**Problem:** No constraint preventing multiple WhatsApp configs per business.

**Fix:** Added unique constraint:
```sql
ALTER TABLE whatsapp_config
    ADD CONSTRAINT unique_whatsapp_per_business UNIQUE (business_id);
```

**Impact:** Each business can only have one WhatsApp configuration.

---

### 4. Template Default Uniqueness - FIXED ✅

**Problem:** Multiple default templates per business possible.

**Fix:** Added partial unique index:
```sql
CREATE UNIQUE INDEX idx_invoice_template_settings_default
ON invoice_template_settings(business_id)
WHERE is_default = true;
```

**Impact:** Only one default template per business allowed.

---

## 🔧 Important Improvements Added

### 5. GST-Specific Fields ✅

Added fields for proper Indian GST handling:

**Businesses table:**
- `state_code VARCHAR(2)` - State code for GST calculations

**Invoices table:**
- `place_of_supply_state_code VARCHAR(2)` - Determines IGST vs CGST+SGST
- `is_reverse_charge BOOLEAN` - For reverse charge mechanism

**Impact:** Better GST report generation (GSTR-1, GSTR-3B)

---

### 6. Opening Balance Type ✅

**Problem:** Opening balances didn't specify if receivable or payable.

**Fix:** Added `opening_balance_type` field:
- `customers.opening_balance_type` - 'debit' or 'credit'
- `suppliers.opening_balance_type` - 'debit' or 'credit'

**Impact:** Clear distinction between receivables and payables.

---

### 7. Expense Categories Table ✅

**Problem:** Expenses had free-text category field, no consistency.

**Fix:** Created `expense_categories` table:
- Normalized structure
- Links to expenses via `category_id`
- Business-specific categories

**Impact:** Better expense reporting and categorization.

---

### 8. Better Payment Structure ✅

**Problem:** Payments used polymorphic `party_id` without foreign keys.

**Fix:** Added explicit columns:
- `customer_id UUID REFERENCES customers(id)`
- `supplier_id UUID REFERENCES suppliers(id)`

**Impact:** Better referential integrity and easier queries.

---

### 9. Performance Indexes ✅

Added indexes for:
- WhatsApp messages (business_id, to_number)
- Invoice lookups (customer_id, date, status)
- Payment queries
- Stock movements

**Impact:** Faster queries and better performance.

---

## 📝 How to Apply Fixes

### Option 1: If Database Already Created

Run the fix script:

```bash
# Connect to database and run
psql -U postgres -d khatario -f database/fix_critical_issues.sql
```

Or using pgAdmin:
1. Open pgAdmin
2. Right-click `khatario` database → Query Tool
3. Open `database/fix_critical_issues.sql`
4. Execute

### Option 2: Before Creating Database

The fixes are now incorporated. Just run the normal migration:

```bash
npm run db:migrate
```

---

## ⚠️ Notes

### Multi-Business Per User

The review mentioned adding `user_business_roles` table for multi-business support. This is **optional** for now. Current schema works fine for single-business-per-user model.

If you need multi-business support later, we can add:
- `user_business_roles` table
- Remove `business_id` from `users` table

### Ledger Entries

The review noted that `ledger_entries` is generic/polymorphic. This is **intentional** for now - sufficient for basic accounting. Can be refactored later if needed for full double-entry accounting system.

### ENUM Types

Currently using VARCHAR for enum-like fields. Can be converted to PostgreSQL ENUM types later for better type safety. Not critical for MVP.

---

## ✅ Verification

After applying fixes, verify:

1. **Invoice uniqueness:**
   ```sql
   -- Should work (different businesses, same invoice number)
   INSERT INTO invoices (business_id, invoice_number, ...) VALUES 
   ('business-1-id', 'INV-001', ...),
   ('business-2-id', 'INV-001', ...);
   ```

2. **WhatsApp config:**
   ```sql
   -- Should fail (second config for same business)
   INSERT INTO whatsapp_config (business_id, ...) VALUES 
   ('business-id', ...),
   ('business-id', ...);  -- This should fail
   ```

3. **Check triggers:**
   ```sql
   SELECT tgname FROM pg_trigger WHERE tgname LIKE '%updated_at%';
   -- Should see all updated_at triggers
   ```

---

## 📊 Summary

All critical issues from the review have been addressed:

- ✅ Invoice number uniqueness per business
- ✅ Missing updated_at triggers
- ✅ WhatsApp config uniqueness
- ✅ Template default uniqueness
- ✅ GST-specific fields added
- ✅ Opening balance types added
- ✅ Expense categories normalized
- ✅ Better payment structure
- ✅ Performance indexes added

**The schema is now production-ready!** 🚀

