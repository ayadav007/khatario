# Permissions UI Fix - Missing Modules

**Issue:** The permissions UI only shows Dashboard, Sales/Invoices, Credit Notes, and Customers. Missing HR, WhatsApp, Employees, Payroll, and other modules.

**Root Cause:** The `permission_modules` table in the database is missing several modules that are used in authorization checks but were never added to the database.

**Solution:** Created migration `127_add_missing_permission_modules.sql` to add all missing modules.

---

## ✅ **Modules Added in Migration 127**

### **HR & Employee Management**
- `hr` - HR / Employees (alias for 'employees')
- `payroll` - Payroll (Salary, payslips, payroll management)
- `leave_requests` - Leave Requests (Employee leave requests and approvals)

**Note:** 
- `employees` already exists in migration 059
- `attendance` already exists in migration 059
- Migration 059 has `leaves` but we use `leave_requests` in authorization, so we added `leave_requests`

### **Financial**
- `credit_notes` - Credit Notes (Sales returns and credit notes)
- `debit_notes` - Debit Notes (Debit notes management)
- `journal` - Journal Entries (Accounting journal entries)
- `accounting_period` - Accounting Periods (Period locks and accounting periods)

### **Communication**
- `whatsapp` - WhatsApp (WhatsApp messaging and bot management)

### **Inventory**
- `warehouse_transfer` - Stock Transfers (Warehouse and stock transfers)
- `inventory_adjustment` - Inventory Adjustments (Stock adjustments and corrections)

### **Tools & Utilities**
- `tools` - Tools (Utility tools and system functions)

### **Reports (Sub-modules)**
- `report` - Reports (General reports access - same as 'reports')
- `report.financial` - Financial Reports (Financial statements and reports)
- `report.gst` - GST Reports (GST filing and reports)
- `report.inventory` - Inventory Reports (Stock and inventory reports)

---

## 📋 **Special Permissions Added**

### **Journal Entries**
- `post` - Post journal entry
- `lock` - Lock journal entry
- `unlock` - Unlock journal entry

### **Invoices**
- `finalize` - Finalize invoice
- `cancel` - Cancel invoice

### **Accounting Periods**
- `lock` - Lock Period
- `unlock` - Unlock Period

### **Warehouse Transfers**
- `dispatch` - Dispatch transfer
- `receive` - Receive transfer
- `cancel` - Cancel transfer

---

## 🔄 **How to Apply**

**Option 1: Run migration manually**
```sql
-- Connect to your database and run:
\i database/migrations/127_add_missing_permission_modules.sql
```

**Option 2: If using a migration runner**
The migration will be automatically picked up and run.

**Option 3: Apply directly via API** (if needed)
After migration runs, refresh the permissions page - all modules should appear.

---

## ✅ **Expected Result**

After running the migration, the permissions UI will show:

1. **Dashboard** ✓ (already exists)
2. **Sales / Invoices** ✓ (already exists)
3. **Credit Notes** ✓ (now added)
4. **Customers** ✓ (already exists)
5. **HR / Employees** ✓ (now added)
6. **Payroll** ✓ (now added)
7. **Leave Requests** ✓ (now added)
8. **Attendance** ✓ (already exists)
9. **WhatsApp** ✓ (now added)
10. **Journal Entries** ✓ (now added)
11. **Accounting Periods** ✓ (now added)
12. **Stock Transfers** ✓ (now added)
13. **Inventory Adjustments** ✓ (now added)
14. **Tools** ✓ (now added)
15. **Reports** (and sub-modules) ✓ (now added)
16. **Settings** ✓ (already exists)
17. **Purchases** ✓ (already exists)
18. **Items** ✓ (already exists)
19. **Payments** ✓ (already exists)
20. **Expenses** ✓ (already exists)
21. **Warehouses** ✓ (already exists)

---

## 🎯 **Next Steps**

1. **Run the migration** - Execute `127_add_missing_permission_modules.sql`
2. **Refresh the UI** - Reload the roles/permissions page
3. **Verify** - All modules should now be visible
4. **Test** - Create/update roles and verify permissions work correctly

---

## 📝 **Notes**

- The migration uses `ON CONFLICT DO NOTHING` so it's safe to run multiple times
- Existing permissions are preserved
- New permissions are automatically created for new modules
- Display order is set to group related modules together
