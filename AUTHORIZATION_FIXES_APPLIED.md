# Authorization Fixes Applied

## ✅ Issues Fixed (This Session)

### 1. Users Not Showing in Manage Users
**Problem:** Frontend wasn't sending `user_id` parameter required by backend.

**Fix:** Updated `app/settings/users/page.tsx`
- Now sends `user_id` in GET request to `/api/settings/users`
- Added error handling for failed requests

### 2. Invoice Creation Page Bypass
**Problem:** Frontend allowed access to invoice creation page even when user lacked `canAdd('invoices')` permission.

**Fix:** Updated `app/invoices/new/page.tsx`
- Added `usePermissions()` hook
- Added `canAdd('invoices')` check with `useEffect`
- Redirects to `/invoices?error=permission_denied` if unauthorized
- Shows "Access Denied" message if permission check fails

### 3. HR Module - Employees Endpoint Authorization
**Problem:** `GET /api/employees` and `POST /api/employees` had no authorization checks.

**Fix:** Updated `app/api/employees/route.ts`
- Added `authorize(userId, 'employees', 'read')` for GET
- Added `authorize(created_by_user_id, 'employees', 'create')` for POST
- Requires `user_id` parameter for GET
- Requires `created_by_user_id` in POST body

---

## ⚠️ Remaining Issues (Requires Systematic Fix)

### Critical: Missing Authorization on API Routes

#### HR Module (26 endpoints - PARTIALLY FIXED)
- ✅ `GET /api/employees` - FIXED
- ✅ `POST /api/employees` - FIXED
- ❌ `GET /api/employees/[id]` - MISSING
- ❌ `PATCH /api/employees/[id]` - MISSING
- ❌ `DELETE /api/employees/[id]` - MISSING
- ❌ `GET /api/employees/attendance` - MISSING
- ❌ `POST /api/employees/attendance/check-in` - MISSING
- ❌ `POST /api/employees/attendance/check-out` - MISSING
- ❌ `GET /api/employees/leave-requests` - MISSING
- ❌ `POST /api/employees/leave-requests` - MISSING
- ❌ All other HR endpoints (see `SECURITY_AUDIT_REPORT.md`)

#### Other Critical Modules
- ❌ Accounts: `/api/accounts/*` - All methods missing authorization
- ❌ Branches: `/api/branches/*` - All methods missing authorization
- ❌ Categories: `/api/categories/*` - All methods missing authorization
- ❌ Bank Accounts: `/api/bank-accounts/*` - All methods missing authorization

**Estimated Total:** 100+ endpoints need authorization added

---

### Frontend Permission Checks Missing

#### Pages That Should Check `canAdd()`
- ❌ `app/customers/new/page.tsx`
- ❌ `app/items/new/page.tsx`
- ❌ `app/purchases/new/page.tsx`
- ❌ `app/employees/new/page.tsx`
- ❌ `app/expenses/new/page.tsx`
- ❌ All other "new" pages

#### Pages That Should Check `canView()`
- ❌ All detail pages (`app/[module]/[id]/page.tsx`)
- ❌ All list pages that don't check permissions

---

## Next Steps

### Immediate (High Priority)
1. **Fix remaining HR endpoints** - Add `authorize()` to all 26 HR routes
2. **Add frontend checks** - Add permission checks to all "new" pages
3. **Fix Accounts/Branches** - Critical infrastructure endpoints

### Short Term
4. **Run comprehensive audit** - Use `scripts/audit-authorization.js`
5. **Fix endpoints in batches** - Group by module, fix systematically
6. **Add tests** - Verify authorization works correctly

### Long Term
7. **Build-time validation** - Prevent merging routes without authorization
8. **Frontend component** - Reusable permission guard component
9. **Documentation** - Update developer guide with authorization patterns

---

## Testing Checklist

- [ ] Test invoice creation with permission denied
- [ ] Test users listing shows all users
- [ ] Test employee creation with/without permission
- [ ] Test employee listing with/without permission
- [ ] Verify frontend blocks access correctly
- [ ] Verify backend denies access correctly

---

## Files Modified

1. `app/settings/users/page.tsx` - Fixed user_id parameter
2. `app/invoices/new/page.tsx` - Added permission check
3. `app/api/employees/route.ts` - Added authorization
4. `SECURITY_AUDIT_REPORT.md` - Created audit report
5. `scripts/audit-authorization.js` - Created audit script

---

## Important Notes

- **Backend is source of truth** - Frontend checks are UX improvements
- **PBAC policies work correctly** - Issue is missing `authorize()` calls
- **Bootstrap mode works** - Settings.create with zero roles is functional
- **Policy registry fixed** - All policies now load correctly
