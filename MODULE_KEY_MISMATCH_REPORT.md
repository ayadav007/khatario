# Module Key Mismatch Audit Report

**Date**: Generated automatically
**Issue**: API authorization calls use different module keys than what's stored in the database, causing permission checks to fail.

---

## Summary

After auditing all `authorize()` calls in the codebase and comparing them with database module keys, I found **1 critical mismatch** that will cause permission denials:

### Critical Mismatch Found

| API Usage | Database Module Key | Status | Files Affected |
|-----------|-------------------|--------|----------------|
| `'invoice'` (singular) | `'invoices'` (plural) | ❌ **MISMATCH** | `app/api/invoices/route.ts` |

---

## Detailed Findings

### ✅ Correctly Matching Module Keys

The following module keys are correctly used in API calls and match the database:

- ✅ `'journal'` - Used in journal-entries routes (matches database)
- ✅ `'payroll'` - Used in salary routes (matches database)
- ✅ `'leave_requests'` - Used in leave routes (matches database)
- ✅ `'purchases'` - Used in purchases routes (matches database)
- ✅ `'settings'` - Used in settings routes (matches database)
- ✅ `'items'` - Used in items/categories routes (matches database)
- ✅ `'payments'` - Used in payments routes (matches database)
- ✅ `'expenses'` - Used in expenses routes (matches database)
- ✅ `'employees'` - Used in employees routes (matches database)
- ✅ `'attendance'` - Used in attendance routes (matches database)
- ✅ `'credit_notes'` - Used in credit-notes routes (matches database)
- ✅ `'invoices'` - Used in debit-notes routes (matches database)
- ✅ `'report'` - Used in report routes (matches database)
- ✅ `'report.financial'` - Used in financial report routes (matches database)
- ✅ `'report.gst'` - Used in GST report routes (matches database)
- ✅ `'report.inventory'` - Used in inventory report routes (matches database)

---

## ❌ Issue #1: Invoice Module Key Mismatch

### Problem

**API Usage**: `'invoice'` (singular)
- Used in: `app/api/invoices/route.ts`
  - Line 26: `await authorize(userId, 'invoice', 'read');`
  - Line 306: `await authorize(created_by, 'invoice', 'create', ...);`

**Database Storage**: `'invoices'` (plural)
- Defined in:
  - `database/migrations/019_user_management_system.sql` line 91
  - `database/migrations/059_rbac.sql` line 56

### Impact

When a user with the "Sales" role tries to:
1. **View invoices** → API calls `authorize(userId, 'invoice', 'read')`
   - Permission check queries: `WHERE module_key = 'invoice'`
   - Database has: `WHERE module_key = 'invoices'`
   - **Result**: No match found → Permission denied ❌

2. **Create invoices** → API calls `authorize(created_by, 'invoice', 'create')`
   - Permission check queries: `WHERE module_key = 'invoice'`
   - Database has: `WHERE module_key = 'invoices'`
   - **Result**: No match found → Permission denied ❌

### Affected Files (All Use 'invoice' Instead of 'invoices')

1. **`app/api/invoices/route.ts`**
   - Line 26: `await authorize(userId, 'invoice', 'read');` → Should be `'invoices'`
   - Line 306: `await authorize(created_by, 'invoice', 'create', ...);` → Should be `'invoices'`

2. **`app/api/invoices/for-reminders/route.ts`**
   - Line 36: `await authorize(userId, 'invoice', 'read');` → Should be `'invoices'`

3. **`app/api/invoices/[id]/pdf/route.ts`**
   - Line 37: `await authorize(userId, 'invoice', 'read', ...);` → Should be `'invoices'`

4. **`app/api/invoices/[id]/preview/route.ts`**
   - Line 37: `await authorize(userId, 'invoice', 'read', ...);` → Should be `'invoices'`

5. **`app/api/invoices/[id]/cancel/route.ts`**
   - Line 26: `await authorize(cancelled_by, 'invoice', 'cancel', ...);` → Should be `'invoices'`

6. **`app/api/invoices/[id]/payments/route.ts`**
   - Line 33: `await authorize(user_id, 'invoice', 'update', ...);` → Should be `'invoices'`

7. **`app/api/invoices/[id]/finalize/route.ts`**
   - Line 44: `await authorize(userId, 'invoice', 'finalize', ...);` → Should be `'invoices'`

8. **`app/api/invoices/[id]/route.ts`**
   - Line 56: `await authorize(userId, 'invoice', 'read', ...);` → Should be `'invoices'`

---

## Database Module Keys Reference

From `database/migrations/`:

### Migration 019 (Old System)
- `'dashboard'`, `'invoices'`, `'credit_notes'`, `'customers'`, `'purchases'`, `'purchase_returns'`, `'suppliers'`, `'items'`, `'payments'`, `'reports'`, `'settings'`

### Migration 059 (New System)
- `'invoices'`, `'items'`, `'customers'`, `'employees'`, `'attendance'`, `'commissions'`, `'leaves'`, `'expenses'`, `'reports'`, `'settings'`, `'purchases'`, `'warehouses'`

### Migration 127 (Additional Modules)
- `'hr'`, `'payroll'`, `'leave_requests'`, `'credit_notes'`, `'debit_notes'`, `'journal'`, `'accounting_period'`, `'whatsapp'`, `'warehouse_transfer'`, `'inventory_adjustment'`, `'tools'`, `'report'`, `'report.financial'`, `'report.gst'`, `'report.inventory'`

---

## Recommendations

1. **Fix All Invoice Routes**: Change `'invoice'` → `'invoices'` in all 8 affected invoice route files:
   - `app/api/invoices/route.ts` (2 occurrences)
   - `app/api/invoices/for-reminders/route.ts` (1 occurrence)
   - `app/api/invoices/[id]/pdf/route.ts` (1 occurrence)
   - `app/api/invoices/[id]/preview/route.ts` (1 occurrence)
   - `app/api/invoices/[id]/cancel/route.ts` (1 occurrence)
   - `app/api/invoices/[id]/payments/route.ts` (1 occurrence)
   - `app/api/invoices/[id]/finalize/route.ts` (1 occurrence)
   - `app/api/invoices/[id]/route.ts` (1 occurrence)
   
   **Total: 9 occurrences across 8 files**

2. **Add Linting Rule**: Consider adding a lint rule or TypeScript type to enforce correct module keys to prevent future mismatches

3. **Test After Fix**: Verify that users with Sales role can now:
   - View invoices list
   - Create new invoices
   - View invoice details
   - Finalize invoices
   - Cancel invoices
   - Add payments to invoices

---

## Note on Authorization Function

The `authorize()` function in `lib/authorization.ts` line 255-256 has a mapping table that attempts to handle both singular and plural:
```typescript
const tableMap: Record<string, string> = {
  'invoice': 'invoices',
  'invoices': 'invoices', // Support both singular and plural
  ...
};
```

However, this mapping is **only for fetching resources** from the database, **NOT for permission checks**. The permission check in `lib/permissions.ts` directly uses the `moduleKey` parameter without any transformation.

---

## Conclusion

**Total Mismatches Found**: 1 critical issue

The `'invoice'` vs `'invoices'` mismatch is causing the reported permission denial. All other module keys appear to be correctly matched between API calls and database storage.
