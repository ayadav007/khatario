# Missing user_id Fixes Applied

## Fixed Issues

### 1. ✅ `/api/purchases` (GET)
- **File**: `app/purchases/page.tsx`
- **Issue**: Missing `user_id` parameter
- **Fix**: Added `user_id` from `useAuth()` hook

### 2. ✅ `/api/suppliers` (GET)  
- **File**: `app/suppliers/page.tsx`
- **Issue**: Missing `user_id` parameter
- **Fix**: Added `user_id` from `useAuth()` hook

### 3. ✅ `/api/suppliers` (GET) - New Purchase Page
- **File**: `app/purchases/new/page.tsx`
- **Issue**: Missing `user_id` in `fetchSuppliers()` function
- **Fix**: Added `user_id` from `useAuth()` hook (already available)

### 4. ✅ `/api/items` (GET)
- **File**: `app/items/page.tsx`
- **Issue**: Missing `user_id` parameter
- **Fix**: Added `user_id` from `useAuth()` hook

### 5. ✅ `/api/customers` (GET)
- **File**: `app/customers/page.tsx`
- **Issue**: Missing `user_id` parameter
- **Fix**: Added `user_id` from `useAuth()` hook

### 6. ✅ `/api/employees` (GET)
- **File**: `app/employees/page.tsx`
- **Issue**: Missing `user_id` parameter
- **Fix**: Added `user_id` from `useAuth()` hook

## Pattern for Fixes

All fixes follow the same pattern:

1. **Extract `user` from `useAuth()`:**
   ```typescript
   const { business, user } = useAuth();
   ```

2. **Add `user_id` to API call parameters:**
   ```typescript
   params.append('user_id', user.id); // REQUIRED for authorization
   ```

3. **Update `useEffect` dependencies:**
   ```typescript
   if (business?.id && user?.id) {
     fetchData();
   }
   ```

## APIs That Still Need Checking

The following APIs require `user_id` - please verify frontend calls:

- `/api/invoices/next-number` (GET) - ✅ Fixed
- `/api/accounts/*` (GET, POST, PATCH, DELETE)
- `/api/bank-accounts/*` (GET, POST, PUT, DELETE)
- `/api/branches/*` (GET, POST, PATCH, DELETE)
- `/api/categories/*` (GET, POST, DELETE)
- `/api/credit-notes` (GET, POST)
- `/api/debit-notes` (GET, POST)
- `/api/expenses` (GET, POST)
- `/api/payments` (GET, POST)
- `/api/journal-entries/*` (GET, POST, PATCH, DELETE)
- All `/api/reports/*` endpoints
- All `/api/employees/*` sub-endpoints (attendance, leave-requests, etc.)
- All `/api/invoices/[id]/*` endpoints
- All `/api/purchases/[id]/*` endpoints

## Next Steps

1. ✅ Fixed: purchases, suppliers, items, customers, employees
2. ⏳ TODO: Check all report pages
3. ⏳ TODO: Check all detail pages (invoices/[id], purchases/[id], etc.)
4. ⏳ TODO: Check all form pages that fetch data
5. ⏳ TODO: Verify all POST/PATCH/DELETE endpoints have user_id in body
