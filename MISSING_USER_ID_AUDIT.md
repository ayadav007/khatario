# Missing user_id Parameter Audit

## 🎯 Summary

This document tracks all frontend pages that make API calls and whether they correctly pass `user_id` when required.

## ✅ Fixed Issues

### 1. **Estimates Page** (`app/(app)/estimates/page.tsx`)
- **Issue**: Was NOT passing `user_id` to `/api/estimates`
- **API Requirement**: `/api/estimates` **REQUIRES** `user_id` for authorization
- **Impact**: Estimates page was returning 400 error and showing empty list
- **Status**: ✅ **FIXED** - Added `params.append('user_id', user!.id);`

---

## 📊 APIs Requiring user_id (110+ endpoints)

Based on grep search, the following APIs require `user_id` for authorization:

### Core Modules
- `/api/invoices` ✅ (Already passing user_id)
- `/api/estimates` ✅ (Fixed)
- `/api/purchases` ✅ (Already passing user_id)
- `/api/customers` ✅ (Already passing user_id)
- `/api/suppliers` ✅ (Already passing user_id)
- `/api/items` ✅ (Already passing user_id)
- `/api/expenses` ✅ (Already passing user_id)
- `/api/payments` ✅ (Already passing user_id)
- `/api/branches` ✅ (Already passing user_id)
- `/api/warehouses` ✅ (Already passing user_id)
- `/api/stock-transfers` ✅ (Already passing user_id)
- `/api/inventory-adjustments` ✅ (Already passing user_id)
- `/api/sales-orders` ✅ (Already passing user_id)
- `/api/credit-notes` ✅ (Already passing user_id)
- `/api/debit-notes` ✅ (Already passing user_id)

### Reports (30+ endpoints)
- `/api/reports/balance-sheet` ✅
- `/api/reports/trial-balance` ✅
- `/api/reports/profit-loss` ✅
- `/api/reports/cash-flow` ✅
- `/api/reports/aging/receivables` ✅
- `/api/reports/aging/payables` ✅
- `/api/reports/stock/*` ✅
- `/api/reports/gst/*` ✅
- `/api/reports/party/*` ✅
- `/api/reports/sales/*` ✅
- `/api/reports/purchase/*` ✅
- `/api/reports/expense/*` ✅

### Settings & Admin
- `/api/settings/users` ✅
- `/api/settings/roles` ✅
- `/api/bank-accounts` ⚠️ (See note below)
- `/api/accounts` ✅
- `/api/categories` ✅
- `/api/period-locks` ✅

### Employees
- `/api/employees` ✅
- `/api/employees/attendance` ✅
- `/api/employees/expenses` ✅
- `/api/employees/leave-requests` ✅
- `/api/employees/salary/payments` ✅
- `/api/employees/salary/advances` ✅
- `/api/employees/commissions` ✅

### Other
- `/api/journal-entries` ✅
- `/api/work-orders` ✅
- `/api/credit-approvals/pending` ✅

---

## ⚠️ APIs NOT Requiring user_id

These APIs do NOT check for `user_id` (no authorization):

- `/api/purchase-returns` ⚠️ **NO AUTH** - Should this be added?
- `/api/expense-categories` ⚠️ **NO AUTH** - Should this be added?
- `/api/suppliers/check-duplicate` ⚠️ **NO AUTH** - Utility endpoint, probably OK
- `/api/template-assignments` ⚠️ **NO AUTH** - Should this be added?
- `/api/subscriptions/check-limit` ⚠️ **NO AUTH** - Utility endpoint, probably OK

---

## 🔍 Potential Security Issues

### High Priority
1. **`/api/purchase-returns`** - No authorization check at all
   - Anyone with a business_id can view/create purchase returns
   - **Recommendation**: Add authorization check

2. **`/api/expense-categories`** - No authorization check
   - Anyone with a business_id can view/modify expense categories
   - **Recommendation**: Add authorization check

3. **`/api/template-assignments`** - No authorization check
   - Anyone with a business_id can view/modify template assignments
   - **Recommendation**: Add authorization check

### Medium Priority
4. **`/api/bank-accounts`** - Has authorization but frontend call returns 400
   - Check `ProfileCompletionBanner.tsx:68` - Missing user_id?

---

## 🛠️ Recommended Actions

### 1. Add Authorization to Unprotected APIs
Add authorization checks to:
- `/api/purchase-returns/route.ts`
- `/api/expense-categories/route.ts`
- `/api/template-assignments/route.ts`

### 2. Fix Frontend Calls
- ✅ `app/(app)/estimates/page.tsx` - FIXED
- Check `components/ProfileCompletionBanner.tsx` for bank-accounts call

### 3. Audit Pattern
Use `buildApiUrl()` helper which automatically includes:
- `user_id` from localStorage
- `branch_id` from branch context

This prevents missing parameters!

---

## 📝 Notes

- Most pages are correctly using `buildApiUrl()` or manually passing `user_id`
- The estimates page was a rare exception where it was manually building params but forgot `user_id`
- Consider enforcing `buildApiUrl()` usage in code reviews to prevent future issues

---

## ✅ Conclusion

**Primary Issue Found**: Estimates page missing `user_id` ✅ **FIXED**

**Secondary Issues**: Several API endpoints lack authorization checks (security concern)

**Recommendation**: Add authorization to unprotected APIs in a separate security audit task.
