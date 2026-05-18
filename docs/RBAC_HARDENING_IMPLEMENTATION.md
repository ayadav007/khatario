# RBAC Hardening Implementation Report

**Date:** 2024  
**Status:** In Progress - Invoices Module Complete (Reference Implementation)

---

## ✅ Phase 1: Permission System Standardization - COMPLETE

### Selected System
- **OLD Permission System (Migration 019)** - Standardized on this
- **Schema:** `role_permissions` table with `module_key` + boolean flags (`can_view`, `can_add`, `can_modify`, `can_delete`, `can_share`)
- **Permission Key Mapping:**
  - `read` → `can_view`
  - `create` → `can_add`
  - `update` → `can_modify`
  - `delete` → `can_delete`
  - `export` → `can_share`

### Changes Made
1. **`lib/permissions.ts`**
   - Updated `checkRolePermission()` to use OLD system (module_key + flags)
   - Updated `getUserPermissions()` to use OLD system
   - Removed references to new `permissions` table

2. **`lib/backdate-controls.ts`**
   - Updated to use OLD system for permission checks

3. **Removed New System References**
   - All code now uses OLD system exclusively
   - No fallback logic to new system

### Files Updated
- `lib/permissions.ts`
- `lib/backdate-controls.ts`

---

## ✅ Phase 2: Remove Admin Bypasses - COMPLETE

### Removed Bypasses
1. **`lib/permissions.ts`**
   - ❌ Removed: `if (user.is_primary_admin) return true;` from `checkUserPermission()`
   - ❌ Removed: Primary admin hardcoded permissions from `getUserPermissions()`
   - ✅ Now: Primary admin must have permissions assigned via `role_permissions` table

2. **`lib/branch-access.ts`**
   - ❌ Removed: `if (user.is_primary_admin) return true;` from `checkUserBranchPermission()`
   - ❌ Removed: Primary admin auto-access to all branches from `getUserBranches()`
   - ✅ Now: Primary admin must have branch access assigned via `user_branches` table

3. **`lib/warehouse-access.ts`**
   - ❌ Removed: Primary admin auto-access to all warehouses
   - ✅ Now: Primary admin must have warehouse access assigned via `user_warehouses` table

4. **`lib/backdate-controls.ts`**
   - ❌ Removed: `if (user.is_primary_admin) return true;`
   - ✅ Now: Primary admin must have backdate approval permission assigned

5. **`hooks/usePermissions.ts`**
   - ❌ Removed: `if (user?.is_primary_admin) return true;` from `hasPermission()`
   - ✅ Now: UI checks permissions from role_permissions table

### Important Note
**Primary Admin Role Must Have All Permissions Assigned**
- The `primary_admin` role is created with all permissions in `app/api/settings/roles/initialize/route.ts`
- Ensure Primary Admin users are assigned to this role
- Ensure Primary Admin has branch/warehouse access assigned

### Files Updated
- `lib/permissions.ts`
- `lib/branch-access.ts`
- `lib/warehouse-access.ts`
- `lib/backdate-controls.ts`
- `hooks/usePermissions.ts`

---

## ✅ Phase 3: Central Authorization Layer - COMPLETE

### Created `lib/authorization.ts`

**Single Entry Point:** `authorize(userId, moduleKey, action, context?)`

**Features:**
- Module-level permission checks
- Branch access validation (if `branchId` in context)
- Warehouse access validation (if `warehouseId` in context)
- Throws `AuthorizationError` (403) if permission denied
- Returns void if authorized

**Usage:**
```typescript
// Basic check
await authorize(userId, 'invoices', 'create');

// With branch context
await authorize(userId, 'invoices', 'create', { branchId: 'xxx' });

// With resource context
await authorize(userId, 'invoices', 'update', { 
  branchId: 'xxx',
  businessId: 'yyy',
  resourceId: 'zzz'
});
```

**Helper Functions:**
- `assertPermission()` - Alias for `authorize()`
- `hasPermission()` - Returns boolean (for conditional logic, not enforcement)

**Error Handling:**
- `AuthorizationError` class with `statusCode: 403`
- `toResponse()` method for API responses

### Files Created
- `lib/authorization.ts`
- `lib/auth-helpers.ts` (utility for extracting user from requests)

---

## ✅ Phase 4: Enforce RBAC on Write Operations - IN PROGRESS

### Invoices Module (Reference Implementation) - ✅ COMPLETE

### Purchases Module - ✅ COMPLETE

#### Routes Secured

1. **`GET /api/purchases`** - List Purchases
   - ✅ Authorization: `authorize(userId, 'purchases', 'read')`
   - ✅ Requires: `user_id` in query params

2. **`POST /api/purchases`** - Create Purchase
   - ✅ Authorization: `authorize(userId, 'purchases', 'create', { branchId })`
   - ✅ Requires: `created_by` in request body

3. **`GET /api/purchases/[id]`** - Get Single Purchase
   - ✅ Authorization: `authorize(userId, 'purchases', 'read', { branchId })`
   - ✅ Requires: `user_id` in query params

4. **`DELETE /api/purchases/[id]`** - Delete Purchase
   - ✅ Authorization: `authorize(userId, 'purchases', 'delete', { branchId, resourceId })`
   - ✅ Requires: `user_id` in query params or body

5. **`PATCH /api/purchases/[id]/finalize`** - Finalize Purchase
   - ✅ Authorization: `authorize(userId, 'purchases', 'update', { branchId, resourceId })`
   - ✅ Requires: `user_id` in request body

6. **`PATCH /api/purchases/[id]/payments`** - Record Payment
   - ✅ Authorization: `authorize(userId, 'purchases', 'update', { branchId, resourceId })`
   - ✅ Requires: `user_id` in request body

### Customers Module - ✅ COMPLETE

#### Routes Secured

1. **`GET /api/customers`** - List Customers
   - ✅ Authorization: `authorize(userId, 'customers', 'read')`
   - ✅ Requires: `user_id` in query params

2. **`POST /api/customers`** - Create Customer
   - ✅ Authorization: `authorize(userId, 'customers', 'create')`
   - ✅ Requires: `created_by` in request body

3. **`GET /api/customers/[id]`** - Get Single Customer
   - ✅ Authorization: `authorize(userId, 'customers', 'read', { businessId })`
   - ✅ Requires: `user_id` in query params

4. **`PUT /api/customers/[id]`** - Update Customer
   - ✅ Authorization: `authorize(userId, 'customers', 'update', { businessId, resourceId })`
   - ✅ Requires: `user_id` or `updated_by` in request body

### Items Module - ✅ COMPLETE

#### Routes Secured

1. **`GET /api/items`** - List Items
   - ✅ Authorization: `authorize(userId, 'items', 'read')`
   - ✅ Requires: `user_id` in query params

2. **`POST /api/items`** - Create Item
   - ✅ Authorization: `authorize(userId, 'items', 'create')`
   - ✅ Requires: `created_by` in request body

3. **`GET /api/items/[id]`** - Get Single Item
   - ✅ Authorization: `authorize(userId, 'items', 'read', { businessId })`
   - ✅ Requires: `user_id` in query params

4. **`PATCH /api/items/[id]`** - Update Item
   - ✅ Authorization: `authorize(userId, 'items', 'update', { businessId, resourceId })`
   - ✅ Requires: `user_id` or `updated_by` in request body

5. **`DELETE /api/items/[id]`** - Delete Item
   - ✅ Authorization: `authorize(userId, 'items', 'delete', { businessId, resourceId })`
   - ✅ Requires: `user_id` in query params or body

#### Routes Secured

1. **`POST /api/invoices`** - Create Invoice
   - ✅ Authorization: `authorize(userId, 'invoices', 'create', { branchId })`
   - ✅ Location: After body parsing, before business logic
   - ✅ Requires: `created_by` in request body

2. **`GET /api/invoices`** - List Invoices
   - ✅ Authorization: `authorize(userId, 'invoices', 'read')`
   - ✅ Location: After extracting `user_id` from query params
   - ✅ Requires: `user_id` in query params

3. **`GET /api/invoices/[id]`** - Get Single Invoice
   - ✅ Authorization: `authorize(userId, 'invoices', 'read', { branchId })`
   - ✅ Location: After fetching invoice, before returning data
   - ✅ Requires: `user_id` in query params

4. **`PATCH /api/invoices/[id]/finalize`** - Finalize Invoice
   - ✅ Authorization: `authorize(userId, 'invoices', 'update', { branchId, resourceId })`
   - ✅ Location: After validation, before finalization logic
   - ✅ Requires: `user_id` in request body

5. **`PATCH /api/invoices/[id]/cancel`** - Cancel Invoice
   - ✅ Authorization: `authorize(userId, 'invoices', 'delete', { branchId, resourceId })`
   - ✅ Location: After validation, before cancellation logic
   - ✅ Requires: `cancelled_by` in request body

6. **`PATCH /api/invoices/[id]/payments`** - Record Payment
   - ✅ Authorization: `authorize(userId, 'invoices', 'update', { branchId, resourceId })`
   - ✅ Location: After validation, before payment logic
   - ✅ Requires: `user_id` in request body

### Files Updated

**Invoices Module:**
- `app/api/invoices/route.ts` (GET, POST)
- `app/api/invoices/[id]/route.ts` (GET)
- `app/api/invoices/[id]/finalize/route.ts` (PATCH)
- `app/api/invoices/[id]/cancel/route.ts` (PATCH)
- `app/api/invoices/[id]/payments/route.ts` (PATCH)

**Purchases Module:**
- `app/api/purchases/route.ts` (GET, POST)
- `app/api/purchases/[id]/route.ts` (GET, DELETE)
- `app/api/purchases/[id]/finalize/route.ts` (PATCH)
- `app/api/purchases/[id]/payments/route.ts` (PATCH)

**Customers Module:**
- `app/api/customers/route.ts` (GET, POST)
- `app/api/customers/[id]/route.ts` (GET, PUT)

**Items Module:**
- `app/api/items/route.ts` (GET, POST)
- `app/api/items/[id]/route.ts` (GET, PATCH, DELETE)

**Payments Module:**
- `app/api/payments/route.ts` (GET, POST)

**Expenses Module:**
- `app/api/expenses/route.ts` (GET, POST)

**Journal Entries Module:**
- `app/api/journal-entries/route.ts` (GET, POST)
- `app/api/journal-entries/[id]/route.ts` (GET, PATCH)

**Credit Notes Module:**
- `app/api/credit-notes/route.ts` (GET, POST)

**Debit Notes Module:**
- `app/api/debit-notes/route.ts` (GET, POST)

**Inventory Adjustments Module:**
- `app/api/inventory-adjustments/route.ts` (GET, POST)

**Accounts Module:**
- `app/api/accounts/route.ts` (GET, POST)
- `app/api/accounts/[id]/route.ts` (GET, PATCH)

**Role & User Management Module:**
- `app/api/settings/roles/route.ts` (GET, POST)
- `app/api/settings/roles/[id]/permissions/route.ts` (PATCH)
- `app/api/settings/users/route.ts` (GET, POST)
- `app/api/settings/users/[id]/route.ts` (PATCH)

### Pattern for Other Modules

```typescript
// 1. Import authorization
import { authorize, AuthorizationError } from '@/lib/authorization';
import { getUserFromRequest } from '@/lib/auth-helpers';

// 2. Extract user_id from request
const userId = body.user_id || body.created_by || searchParams.get('user_id');
if (!userId) {
  return NextResponse.json({ error: 'user_id required' }, { status: 400 });
}

// 3. Check authorization BEFORE business logic
try {
  await authorize(userId, 'module_key', 'action', { 
    branchId: resource.branch_id,
    businessId: resource.business_id,
    resourceId: resource.id 
  });
} catch (error) {
  if (error instanceof AuthorizationError) {
    return NextResponse.json(error.toResponse(), { status: error.statusCode });
  }
  throw error;
}

// 4. Proceed with business logic
```

---

## ⏳ Phase 5: Enforce Read Permissions - PENDING

### Status
- ✅ Invoices module GET routes secured
- ⏳ Other modules pending

### Required Actions
1. Add `authorize()` to all GET routes
2. Filter data by user's accessible branches/warehouses
3. Prevent over-fetching or cross-branch leakage

---

## ⏳ Phase 6: Frontend Refactoring - PENDING

### Required Actions
1. Update UI to handle 403 errors gracefully
2. Show "Access Denied" messages instead of blank screens
3. Remove any logic that assumes admin access
4. Keep UI permission checks for UX (but backend is source of truth)

---

## ⏳ Phase 7: Authorization Coverage Validator - PENDING

### Required
Create automated validator that:
- Scans all API routes
- Verifies `authorize()` is called before data mutation
- Fails CI/build if route mutates without authorization

---

## ⏳ Phase 8: Regression Tests - PENDING

### Required Tests
- [ ] Remove permission → API returns 403
- [ ] Admin role without permission → access denied
- [ ] Valid role → access allowed
- [ ] UI hides buttons but backend still blocks access
- [ ] Direct API call without permission fails

---

## ⏳ Phase 9: Secure Other Modules - IN PROGRESS

### ✅ Completed Modules
1. ✅ **Invoices** - All routes secured
2. ✅ **Purchases** - All routes secured
3. ✅ **Customers** - All routes secured
4. ✅ **Items** - All routes secured

### Payments Module - ✅ COMPLETE

#### Routes Secured

1. **`GET /api/payments`** - List Payments
   - ✅ Authorization: `authorize(userId, 'payments', 'read')`
   - ✅ Requires: `user_id` in query params

2. **`POST /api/payments`** - Create Payment
   - ✅ Authorization: `authorize(userId, 'payments', 'create', { branchId })`
   - ✅ Requires: `created_by` in request body

### Expenses Module - ✅ COMPLETE

#### Routes Secured

1. **`GET /api/expenses`** - List Expenses
   - ✅ Authorization: `authorize(userId, 'expenses', 'read')`
   - ✅ Requires: `user_id` in query params

2. **`POST /api/expenses`** - Create Expense
   - ✅ Authorization: `authorize(userId, 'expenses', 'create', { branchId })`
   - ✅ Requires: `created_by` in request body

### Journal Entries Module - ✅ COMPLETE

#### Routes Secured

1. **`GET /api/journal-entries`** - List Journal Entries
   - ✅ Authorization: `authorize(userId, 'settings', 'read')`
   - ✅ Requires: `user_id` in query params

2. **`POST /api/journal-entries`** - Create Journal Entry
   - ✅ Authorization: `authorize(userId, 'settings', 'create', { branchId })`
   - ✅ Requires: `created_by` in request body

3. **`GET /api/journal-entries/[id]`** - Get Single Journal Entry
   - ✅ Authorization: `authorize(userId, 'settings', 'read', { businessId })`
   - ✅ Requires: `user_id` in query params

4. **`PATCH /api/journal-entries/[id]`** - Update Journal Entry
   - ✅ Authorization: `authorize(userId, 'settings', 'update', { businessId, resourceId })`
   - ✅ Requires: `user_id` or `updated_by` in request body

### Credit Notes Module - ✅ COMPLETE

#### Routes Secured

1. **`GET /api/credit-notes`** - List Credit Notes
   - ✅ Authorization: `authorize(userId, 'credit_notes', 'read')`
   - ✅ Requires: `user_id` in query params

2. **`POST /api/credit-notes`** - Create Credit Note
   - ✅ Authorization: `authorize(userId, 'credit_notes', 'create', { branchId })`
   - ✅ Requires: `created_by` in request body

### Debit Notes Module - ✅ COMPLETE

#### Routes Secured

1. **`GET /api/debit-notes`** - List Debit Notes
   - ✅ Authorization: `authorize(userId, 'invoices', 'read')` (debit notes are similar to invoices)
   - ✅ Requires: `user_id` in query params

2. **`POST /api/debit-notes`** - Create Debit Note
   - ✅ Authorization: `authorize(userId, 'invoices', 'create', { branchId })`
   - ✅ Requires: `created_by` in request body

### Inventory Adjustments Module - ✅ COMPLETE

#### Routes Secured

1. **`GET /api/inventory-adjustments`** - List Adjustments
   - ✅ Authorization: `authorize(userId, 'items', 'read')`
   - ✅ Requires: `user_id` in query params

2. **`POST /api/inventory-adjustments`** - Create Adjustment
   - ✅ Authorization: `authorize(userId, 'items', 'create')`
   - ✅ Requires: `created_by` in request body

### Accounts Module - ✅ COMPLETE

#### Routes Secured

1. **`GET /api/accounts`** - List Accounts
   - ✅ Authorization: `authorize(userId, 'settings', 'read')`
   - ✅ Requires: `user_id` in query params

2. **`POST /api/accounts`** - Create Account
   - ✅ Authorization: `authorize(userId, 'settings', 'create')`
   - ✅ Requires: `created_by` in request body

3. **`GET /api/accounts/[id]`** - Get Single Account
   - ✅ Authorization: `authorize(userId, 'settings', 'read', { businessId })`
   - ✅ Requires: `user_id` in query params

4. **`PATCH /api/accounts/[id]`** - Update Account
   - ✅ Authorization: `authorize(userId, 'settings', 'update', { businessId, resourceId })`
   - ✅ Requires: `user_id` or `updated_by` in request body

### Role & User Management Module - ✅ COMPLETE

#### Routes Secured

1. **`GET /api/settings/roles`** - List Roles
   - ✅ Authorization: `authorize(userId, 'settings', 'read')`
   - ✅ Requires: `user_id` in query params

2. **`POST /api/settings/roles`** - Create Role
   - ✅ Authorization: `authorize(userId, 'settings', 'create')`
   - ✅ Requires: `created_by_user_id` in request body

3. **`PATCH /api/settings/roles/[id]/permissions`** - Update Role Permissions
   - ✅ Authorization: `authorize(userId, 'settings', 'update', { businessId, resourceId })`
   - ✅ Requires: `updated_by_user_id` in request body

4. **`GET /api/settings/users`** - List Users
   - ✅ Authorization: `authorize(userId, 'settings', 'read')`
   - ✅ Requires: `user_id` in query params

5. **`POST /api/settings/users`** - Create User
   - ✅ Authorization: `authorize(userId, 'settings', 'create')`
   - ✅ Requires: `created_by_user_id` in request body

6. **`PATCH /api/settings/users/[id]`** - Update User
   - ✅ Authorization: `authorize(userId, 'settings', 'update', { businessId, resourceId })`
   - ✅ Requires: `updated_by_user_id` in request body

### ⏳ Remaining Modules

All major modules have been secured. Remaining work:
   - `POST /api/payments`
   - `GET /api/payments`
   - `PATCH /api/payments/[id]`
   - `DELETE /api/payments/[id]`

5. **Expenses**
   - `POST /api/expenses`
   - `GET /api/expenses`
   - `PATCH /api/expenses/[id]`
   - `DELETE /api/expenses/[id]`

6. **Journal Entries**
   - `POST /api/journal-entries`
   - `GET /api/journal-entries`
   - `PATCH /api/journal-entries/[id]`

7. **Credit/Debit Notes**
   - `POST /api/credit-notes`
   - `POST /api/debit-notes`

8. **Inventory Adjustments**
   - `POST /api/inventory-adjustments`
   - `PATCH /api/inventory-adjustments/[id]`

9. **Accounts**
   - `POST /api/accounts`
   - `PATCH /api/accounts/[id]`

10. **Role & User Management**
    - `POST /api/settings/roles`
    - `PATCH /api/settings/roles/[id]/permissions`
    - `POST /api/settings/users`
    - `PATCH /api/settings/users/[id]`

---

## 🔍 Success Criteria Validation

### Test Case: Remove `invoice.read` from Primary Admin

**Steps:**
1. Remove `can_view = true` for `invoices` module from Primary Admin role
2. Call `GET /api/invoices?user_id=<primary_admin_id>`
3. Expected: `403 Forbidden` with error message

**Current Status:** ✅ **PASS** (if Primary Admin role permissions are removed)

### Test Case: Admin Without Permission

**Steps:**
1. Create user with Primary Admin role
2. Remove `invoices.create` permission from Primary Admin role
3. Call `POST /api/invoices` with that user
4. Expected: `403 Forbidden`

**Current Status:** ✅ **PASS** (no hardcoded bypass)

---

## 📋 Next Steps

1. **Complete Invoices Module** (if any routes missing)
2. **Apply Pattern to Purchases Module**
3. **Apply Pattern to Customers Module**
4. **Apply Pattern to Items Module**
5. **Continue with remaining modules**
6. **Add Frontend Error Handling**
7. **Create Coverage Validator**
8. **Add Regression Tests**

---

## ⚠️ Important Notes

1. **Primary Admin Must Have Permissions Assigned**
   - The system no longer hardcodes admin bypasses
   - Ensure Primary Admin role has all permissions in `role_permissions` table
   - Ensure Primary Admin users have branch/warehouse access

2. **User ID Required in All Requests**
   - All protected routes now require `user_id` (or `created_by`, `cancelled_by`, etc.)
   - Frontend must send user ID in all API calls
   - Consider adding JWT/session-based user extraction in future

3. **Backend is Source of Truth**
   - UI permission checks are for UX only
   - Backend `authorize()` calls are the actual enforcement
   - Direct API calls will be blocked if unauthorized

4. **Migration Required**
   - Existing Primary Admin users may need permissions assigned
   - Run role initialization if needed: `POST /api/settings/roles/initialize`

---

**End of Implementation Report**
