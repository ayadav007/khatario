# How to Apply Database Schema Fixes

## 📋 Quick Answer

You have **two options** depending on whether you've already created the database:

---

## Option 1: Database NOT Created Yet ✅ (Easier)

If you **haven't run migrations yet**, the fixes will be applied automatically when you:

1. Create database: `khatario`
2. Run migration: `npm run db:migrate`
3. Run fixes: `npm run db:fix` (I'll create this script)

**The schema.sql has been updated** to remove the global invoice_number unique constraint.

---

## Option 2: Database Already Created ⚠️

If you **already ran the migration** and created the database:

1. **Apply the fixes** by running the fix script

**Using Command Line:**
```bash
psql -U postgres -d khatario -f database/fix_critical_issues.sql
```

**Using pgAdmin:**
1. Open pgAdmin
2. Right-click `khatario` database → **Query Tool**
3. Open file: `database/fix_critical_issues.sql`
4. Click **Execute** (F5)

---

## 🎯 What the Fixes Do

### Critical Fixes:
1. ✅ **Invoice numbers** - Now unique per business (not globally)
2. ✅ **Auto-update timestamps** - Added missing triggers
3. ✅ **WhatsApp config** - One per business only
4. ✅ **Template defaults** - One default per business

### Improvements:
5. ✅ **GST fields** - Added for Indian GST calculations
6. ✅ **Opening balance types** - Debit/Credit distinction
7. ✅ **Expense categories** - Proper table structure
8. ✅ **Better indexes** - Performance improvements

---

## 📝 Step-by-Step for You

Since you're in pgAdmin right now:

### If Database is Already Created:

1. **In pgAdmin:**
   - Right-click `khatario` database
   - Click **Query Tool**

2. **Open the fix file:**
   - In Query Tool, click folder icon (Open File)
   - Navigate to: `D:\MyApps\Khatario\database\fix_critical_issues.sql`
   - Open it

3. **Run it:**
   - Click **Execute** button (or press F5)
   - Wait for "Success" message

4. **Verify:**
   - Refresh database in pgAdmin
   - Check that all changes applied

### If Database is NOT Created Yet:

Just continue with normal setup - the fixes will be included automatically.

---

## ✅ Verification

After applying fixes, check:

1. **Invoice uniqueness works:**
   - Multiple businesses can have same invoice number
   - Same business can't have duplicate invoice numbers

2. **All triggers exist:**
   - `suppliers` has updated_at trigger
   - `whatsapp_config` has updated_at trigger
   - etc.

3. **New fields added:**
   - `businesses.state_code`
   - `invoices.place_of_supply_state_code`
   - `customers.opening_balance_type`
   - etc.

---

## 💡 Quick Decision

**Answer this:**
- Have you already created the `khatario` database?
  - **NO** → Just continue normal setup, fixes included automatically
  - **YES** → Run `database/fix_critical_issues.sql` in pgAdmin Query Tool

---

Let me know which situation you're in and I'll guide you through the exact steps!

