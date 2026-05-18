# RBAC Security Audit Report
**Date:** 2024  
**Scope:** Complete Role-Based Access Control System Analysis  
**Status:** Pre-Implementation Audit (Do Not Modify Yet)

---

## Executive Summary

This audit identifies **critical security vulnerabilities** in the RBAC implementation. The system has **widespread permission bypass mechanisms**, **missing server-side checks**, and **inconsistent enforcement** across API routes. **Immediate action required** before production deployment.

**Risk Level:** 🔴 **CRITICAL**

---

## 1. Role Definitions

### 1.1 Default Roles

| Role | Key | System Role | Description |
|------|-----|-------------|-------------|
| Primary Admin | `primary_admin` | ✅ Yes | Full access to all features |
| Sales | `sales` | ✅ Yes | Create and manage sales invoices |
| Accountant | `accountant` | ✅ Yes | Manage finances and payments |
| Inventory Manager | `inventory_manager` | ✅ Yes | Manage inventory and purchases |

**Location:** `database/migrations/019_user_management_system.sql` (lines 103-170)

### 1.2 Role Creation

- **API:** `POST /api/settings/roles`
- **Location:** `app/api/settings/roles/route.ts`
- **Issues:**
  - ✅ Roles can be created
  - ⚠️ No permission check to create roles (any user can create roles)
  - ⚠️ No validation that creator has `settings` module permissions

---

## 2. Permission Structure

### 2.1 Dual Permission Systems (CRITICAL ISSUE)

The system has **TWO incompatible permission schemas**:

#### **Old System (Migration 019)**
- **Table:** `role_permissions`
- **Schema:** `module_key` + boolean flags (`can_view`, `can_add`, `can_modify`, `can_delete`, `can_share`)
- **Status:** Currently active in database
- **Location:** `database/migrations/019_user_management_system.sql`

#### **New System (Migration 059)**
- **Tables:** `permissions`, `permission_modules`, `role_permissions` (different schema)
- **Schema:** `permission_id` + `granted` boolean
- **Status:** Migration not run (table doesn't exist)
- **Location:** `database/migrations/059_rbac.sql`

**Impact:** APIs attempt to use new system but fall back to old system, causing:
- Inconsistent permission checks
- Potential security gaps
- Confusion in permission mapping

### 2.2 Permission Modules

**Old System Modules:**
- `dashboard`, `invoices`, `credit_notes`, `customers`, `purchases`, `purchase_returns`, `suppliers`, `items`, `payments`, `reports`, `settings`

**New System Modules:**
- `invoices`, `items`, `customers`, `employees`, `attendance`, `commissions`, `leaves`, `expenses`, `reports`, `settings`, `purchases`, `warehouses`

**Mismatch:** Modules differ between systems, causing permission gaps.

### 2.3 Permission Actions

**Old System:** `can_view`, `can_add`, `can_modify`, `can_delete`, `can_share`  
**New System:** `create`, `read`, `update`, `delete`, `approve`, `export`

**Mapping Issue:** APIs convert between formats, but mapping may be incomplete.

---

## 3. Permission Check Locations

### 3.1 Server-Side Permission Checks

#### ✅ **Implemented Checks**

1. **`lib/permissions.ts`**
   - `checkUserPermission(userId, moduleKey, permissionKey)` - ✅ Implemented
   - `checkRolePermission(roleId, moduleKey, permissionKey)` - ✅ Implemented
   - `getUserPermissions(userId)` - ✅ Implemented
   - `checkFieldPermission(roleId, moduleKey, fieldName, action)` - ✅ Implemented

2. **Branch Access (`lib/branch-access.ts`)**
   - `checkUserBranchPermission(userId, branchId, permission)` - ✅ Implemented
   - `assertUserBranchPermission(userId, branchId, permission)` - ✅ Implemented
   - **Bypass:** Primary admin gets all permissions (line 46-48)

3. **Warehouse Access (`lib/warehouse-access.ts`)**
   - `checkUserWarehousePermission(userId, warehouseId, permission)` - ✅ Implemented
   - `assertUserWarehousePermission(userId, warehouseId, permission)` - ✅ Implemented
   - **Bypass:** Primary admin gets all permissions (line 27-42)

4. **Backdate Controls (`lib/backdate-controls.ts`)**
   - `hasBackdateApprovalPermission(userId)` - ✅ Implemented
   - **Bypass:** Primary admin can always backdate (line 74)

#### ❌ **Missing Checks**

**CRITICAL:** Most API routes **DO NOT** check permissions before allowing operations:

1. **Invoice Operations**
   - `POST /api/invoices` - ❌ No permission check
   - `PATCH /api/invoices/[id]` - ❌ No permission check
   - `DELETE /api/invoices/[id]` - ❌ No permission check
   - `POST /api/invoices/[id]/finalize` - ❌ No permission check
   - `POST /api/invoices/[id]/payments` - ❌ No permission check

2. **Purchase Operations**
   - `POST /api/purchases` - ❌ No permission check
   - `PATCH /api/purchases/[id]` - ❌ No permission check
   - `DELETE /api/purchases/[id]` - ❌ No permission check
   - `POST /api/purchases/[id]/finalize` - ❌ No permission check

3. **Customer Operations**
   - `POST /api/customers` - ❌ No permission check
   - `PATCH /api/customers/[id]` - ❌ No permission check
   - `DELETE /api/customers/[id]` - ❌ No permission check

4. **Item Operations**
   - `POST /api/items` - ❌ No permission check
   - `PATCH /api/items/[id]` - ❌ No permission check
   - `DELETE /api/items/[id]` - ❌ No permission check

5. **Payment Operations**
   - `POST /api/payments` - ❌ No permission check
   - `PATCH /api/payments/[id]` - ❌ No permission check
   - `DELETE /api/payments/[id]` - ❌ No permission check

6. **Expense Operations**
   - `POST /api/expenses` - ❌ No permission check
   - `PATCH /api/expenses/[id]` - ❌ No permission check
   - `DELETE /api/expenses/[id]` - ❌ No permission check

7. **Journal Entry Operations**
   - `POST /api/journal-entries` - ❌ No permission check
   - `PATCH /api/journal-entries/[id]` - ❌ No permission check

8. **Account Operations**
   - `POST /api/accounts` - ❌ No permission check
   - `PATCH /api/accounts/[id]` - ❌ No permission check

9. **Credit/Debit Notes**
   - `POST /api/credit-notes` - ❌ No permission check
   - `POST /api/debit-notes` - ❌ No permission check

10. **Inventory Operations**
    - `POST /api/inventory-adjustments` - ❌ No permission check
    - `PATCH /api/inventory-adjustments/[id]` - ❌ No permission check

### 3.2 Client-Side Permission Checks

#### ✅ **Implemented**

1. **`hooks/usePermissions.ts`**
   - `hasPermission(module, action)` - ✅ Implemented
   - `canView(module)` - ✅ Implemented
   - `canAdd(module)` - ✅ Implemented
   - `canModify(module)` - ✅ Implemented
   - `canDelete(module)` - ✅ Implemented
   - `canShare(module)` - ✅ Implemented
   - **Bypass:** Primary admin always returns `true` (line 45-47)

#### ⚠️ **UI-Only Checks (Security Risk)**

**CRITICAL:** Client-side checks can be bypassed by:
- Direct API calls (curl, Postman, etc.)
- Browser DevTools manipulation
- API client tools

**Example Vulnerabilities:**
- User without `invoices.create` permission can call `POST /api/invoices` directly
- User without `items.delete` permission can call `DELETE /api/items/[id]` directly
- UI hides buttons, but API accepts requests

---

## 4. Permission Bypass Mechanisms

### 4.1 Primary Admin Bypass (Hardcoded)

**Location:** Multiple files

1. **`lib/permissions.ts`** (lines 60-63)
   ```typescript
   if (user.is_primary_admin) {
     return true; // Bypasses all permission checks
   }
   ```

2. **`lib/branch-access.ts`** (lines 42-48)
   ```typescript
   if (user?.is_primary_admin) {
     return true; // Bypasses branch access checks
   }
   ```

3. **`lib/warehouse-access.ts`** (lines 19-42)
   ```typescript
   if (user.is_primary_admin) {
     // Returns all warehouses with full permissions
   }
   ```

4. **`lib/backdate-controls.ts`** (line 74)
   ```typescript
   if (user.is_primary_admin) {
     return true; // Can always backdate
   }
   ```

5. **`hooks/usePermissions.ts`** (lines 44-47)
   ```typescript
   if (user?.is_primary_admin) {
     return true; // UI bypass
   }
   ```

**Risk:** 
- ✅ **Intended behavior** for primary admin
- ⚠️ **No audit trail** when primary admin bypasses permissions
- ⚠️ **No way to restrict** primary admin actions

### 4.2 Missing Permission Checks (CRITICAL)

**All API routes that modify data lack permission checks:**

| Route | Method | Missing Check | Risk Level |
|-------|--------|---------------|------------|
| `/api/invoices` | POST | `invoices.create` | 🔴 CRITICAL |
| `/api/invoices/[id]` | PATCH | `invoices.update` | 🔴 CRITICAL |
| `/api/invoices/[id]` | DELETE | `invoices.delete` | 🔴 CRITICAL |
| `/api/purchases` | POST | `purchases.create` | 🔴 CRITICAL |
| `/api/purchases/[id]` | PATCH | `purchases.update` | 🔴 CRITICAL |
| `/api/customers` | POST | `customers.create` | 🔴 CRITICAL |
| `/api/customers/[id]` | PATCH | `customers.update` | 🔴 CRITICAL |
| `/api/items` | POST | `items.create` | 🔴 CRITICAL |
| `/api/items/[id]` | PATCH | `items.update` | 🔴 CRITICAL |
| `/api/payments` | POST | `payments.create` | 🔴 CRITICAL |
| `/api/expenses` | POST | `expenses.create` | 🔴 CRITICAL |
| `/api/journal-entries` | POST | `settings.create` (or custom) | 🔴 CRITICAL |
| `/api/credit-notes` | POST | `credit_notes.create` | 🔴 CRITICAL |
| `/api/debit-notes` | POST | `invoices.create` (or custom) | 🔴 CRITICAL |

**Impact:** Any authenticated user can perform any operation by calling APIs directly.

### 4.3 Business ID Validation Only

**Current Protection:**
- Most APIs check `business_id` matches user's business
- Prevents cross-business access

**Missing Protection:**
- No check if user has permission for the operation
- User can modify any data within their business

**Example:**
```typescript
// Current check (insecure):
if (invoice.business_id !== user.business_id) {
  return 403; // ✅ Prevents cross-business access
}

// Missing check:
if (!await checkUserPermission(user.id, 'invoices', 'update')) {
  return 403; // ❌ NOT IMPLEMENTED
}
```

---

## 5. Hardcoded Admin Logic

### 5.1 Primary Admin Flag

**Location:** `users.is_primary_admin` column

**Usage:**
- Hardcoded bypass in all permission functions
- No way to revoke primary admin status programmatically
- No audit trail for primary admin actions

**Risk:** If `is_primary_admin` is set to `true` for a user, they bypass ALL permission checks.

### 5.2 Role Key Checks

**Location:** `app/api/settings/roles/[id]/permissions/route.ts` (line 38)

```typescript
if (role.role_key === 'primary_admin') {
  return NextResponse.json(
    { error: 'Cannot modify Primary Admin permissions' },
    { status: 403 }
  );
}
```

**Issue:** Only prevents modifying permissions, but doesn't prevent:
- Deleting the role
- Changing role_key
- Assigning role to different users

---

## 6. UI-Only Permission Checks

### 6.1 Components Using `usePermissions`

**Location:** `hooks/usePermissions.ts`

**Usage Pattern:**
```typescript
const { canAdd, canModify, canDelete } = usePermissions();

{canAdd('invoices') && <Button>Create Invoice</Button>}
{canModify('invoices') && <Button>Edit</Button>}
{canDelete('invoices') && <Button>Delete</Button>}
```

**Vulnerability:**
- UI hides buttons, but API accepts requests
- User can call API directly via:
  - Browser DevTools → Network tab → Copy as cURL
  - Postman/Insomnia
  - Custom scripts

**Example Attack:**
1. User with "Sales" role (no delete permission)
2. UI hides "Delete Invoice" button
3. User opens DevTools → Network tab
4. User creates invoice → sees API call
5. User modifies request to DELETE method
6. ✅ **Invoice deleted** (API has no permission check)

### 6.2 Missing UI Checks

**No permission checks found in:**
- Most invoice pages
- Most purchase pages
- Most customer pages
- Most item pages

**Impact:** Even UI-level protection is missing in many places.

---

## 7. RBAC Weak Points

### 7.1 Critical Vulnerabilities

1. **🔴 No Server-Side Permission Enforcement**
   - **Impact:** Any authenticated user can perform any operation
   - **Severity:** CRITICAL
   - **Affected Routes:** 50+ API endpoints
   - **Fix Required:** Add `checkUserPermission()` to all write operations

2. **🔴 Dual Permission System**
   - **Impact:** Inconsistent permission checks, potential security gaps
   - **Severity:** HIGH
   - **Fix Required:** Migrate to single system (run migration 059 or remove it)

3. **🔴 UI-Only Checks**
   - **Impact:** Client-side checks can be bypassed
   - **Severity:** CRITICAL
   - **Fix Required:** Add server-side checks (UI checks are not security)

4. **🔴 No Permission Checks on Critical Operations**
   - **Impact:** Users can create/modify/delete without permission
   - **Severity:** CRITICAL
   - **Operations Affected:**
     - Invoice creation/modification/deletion
     - Purchase creation/modification
     - Customer management
     - Item management
     - Payment recording
     - Journal entries
     - Account modifications

5. **🟡 Primary Admin Bypass (Intended but Unaudited)**
   - **Impact:** No audit trail for primary admin actions
   - **Severity:** MEDIUM
   - **Fix Required:** Add audit logging for bypass actions

6. **🟡 No Role Assignment Validation**
   - **Impact:** Users can be assigned roles without checking if assigner has permission
   - **Severity:** MEDIUM
   - **Location:** `app/api/settings/users/route.ts`

7. **🟡 Branch/Warehouse Access Bypass**
   - **Impact:** Primary admin bypasses branch/warehouse restrictions
   - **Severity:** MEDIUM (intended, but should be audited)

### 7.2 Inconsistencies

1. **Permission Module Mismatch**
   - Old system: `dashboard`, `credit_notes`, `purchase_returns`
   - New system: Missing some modules, has different ones
   - **Impact:** Permissions may not map correctly

2. **Action Mapping**
   - Old: `can_view`, `can_add`, `can_modify`, `can_delete`, `can_share`
   - New: `create`, `read`, `update`, `delete`, `approve`, `export`
   - **Impact:** Conversion logic may miss some permissions

3. **Field-Level Permissions**
   - **Status:** Implemented but **never used**
   - **Location:** `lib/permissions.ts` (lines 128-152)
   - **Impact:** Feature exists but provides no protection

---

## 8. Places Where RBAC is Unsafe or Ignored

### 8.1 Completely Unprotected Routes

**All write operations are unprotected:**

1. **Invoice Management**
   - `POST /api/invoices` - Create invoice
   - `PATCH /api/invoices/[id]` - Update invoice
   - `DELETE /api/invoices/[id]` - Delete invoice
   - `POST /api/invoices/[id]/finalize` - Finalize invoice
   - `POST /api/invoices/[id]/payments` - Record payment

2. **Purchase Management**
   - `POST /api/purchases` - Create purchase
   - `PATCH /api/purchases/[id]` - Update purchase
   - `POST /api/purchases/[id]/finalize` - Finalize purchase

3. **Customer Management**
   - `POST /api/customers` - Create customer
   - `PATCH /api/customers/[id]` - Update customer
   - `DELETE /api/customers/[id]` - Delete customer

4. **Item Management**
   - `POST /api/items` - Create item
   - `PATCH /api/items/[id]` - Update item
   - `DELETE /api/items/[id]` - Delete item

5. **Payment Management**
   - `POST /api/payments` - Create payment
   - `PATCH /api/payments/[id]` - Update payment

6. **Expense Management**
   - `POST /api/expenses` - Create expense
   - `PATCH /api/expenses/[id]` - Update expense

7. **Journal Entries**
   - `POST /api/journal-entries` - Create journal entry
   - `PATCH /api/journal-entries/[id]` - Update journal entry

8. **Credit/Debit Notes**
   - `POST /api/credit-notes` - Create credit note
   - `POST /api/debit-notes` - Create debit note

9. **Inventory Adjustments**
   - `POST /api/inventory-adjustments` - Create adjustment
   - `PATCH /api/inventory-adjustments/[id]` - Update adjustment

10. **Account Management**
    - `POST /api/accounts` - Create account
    - `PATCH /api/accounts/[id]` - Update account

### 8.2 Partially Protected Routes

**Routes with business_id check but no permission check:**

- All routes listed above check `business_id` but don't check permissions
- User can access any data within their business

### 8.3 Role Management Routes

**`POST /api/settings/roles`**
- ❌ No permission check to create roles
- ❌ Any user can create custom roles
- ⚠️ Only checks if role_key already exists

**`PATCH /api/settings/roles/[id]/permissions`**
- ✅ Prevents modifying `primary_admin` permissions
- ❌ No check if user has permission to modify roles
- ❌ Any user can modify any role's permissions

**`POST /api/settings/users`**
- ⚠️ Checks subscription limits
- ❌ No permission check to create users
- ❌ No check if user has `settings` module permissions

### 8.4 Read-Only Routes (Lower Risk)

**GET routes are generally safe** (read-only), but should still check:
- `GET /api/invoices` - Should filter by user's accessible branches
- `GET /api/purchases` - Should filter by user's accessible branches
- `GET /api/reports/*` - Should check `reports.read` permission

**Current Status:**
- Some GET routes filter by branch (if `user_id` provided)
- No permission checks for read access
- Reports may expose sensitive data to unauthorized users

---

## 9. Security Recommendations

### 9.1 Immediate Actions (P0 - Critical)

1. **Add Permission Checks to All Write Operations**
   - Add `checkUserPermission()` to all POST/PATCH/DELETE routes
   - Use `assertUserPermission()` helper that throws on failure
   - **Estimated Impact:** 50+ API routes need updates

2. **Standardize Permission System**
   - Run migration 059 OR remove it
   - Use single permission system consistently
   - Update all permission checks to use same format

3. **Add Permission Checks to Role Management**
   - Only users with `settings.modify` can create/modify roles
   - Only users with `settings.modify` can assign roles
   - Prevent non-admin users from creating admin roles

4. **Add Audit Logging**
   - Log all permission checks (pass/fail)
   - Log primary admin bypass actions
   - Track who modified what and when

### 9.2 High Priority (P1)

1. **Add Read Permission Checks**
   - Check `module.read` for all GET routes
   - Filter data by user's accessible branches/warehouses
   - Prevent unauthorized data access

2. **Implement Field-Level Permissions**
   - Use existing `checkFieldPermission()` function
   - Apply to sensitive fields (prices, costs, etc.)
   - Document which fields are protected

3. **Add Permission Checks to Reports**
   - Check `reports.read` or `reports.export` permissions
   - Filter report data by user's accessible branches
   - Prevent unauthorized report access

### 9.3 Medium Priority (P2)

1. **Improve Primary Admin Handling**
   - Add audit trail for primary admin actions
   - Consider role-based approach instead of flag
   - Allow restricting primary admin if needed

2. **Add Permission Validation on Role Assignment**
   - Check if assigner has permission to assign roles
   - Prevent privilege escalation
   - Validate role permissions before assignment

3. **Add UI Permission Checks**
   - Use `usePermissions()` hook consistently
   - Hide/disable UI elements based on permissions
   - Show helpful error messages when permission denied

---

## 10. Summary

### 10.1 Critical Issues Found

| Issue | Count | Severity |
|-------|-------|----------|
| Missing permission checks on write operations | 50+ | 🔴 CRITICAL |
| UI-only permission checks | 100+ | 🔴 CRITICAL |
| Dual permission system | 1 | 🔴 HIGH |
| No role management permission checks | 3 | 🔴 HIGH |
| Missing read permission checks | 30+ | 🟡 MEDIUM |

### 10.2 Security Posture

**Current State:** 🔴 **INSECURE**

- Any authenticated user can perform any operation
- Permission system exists but is not enforced
- UI provides false sense of security
- Direct API calls bypass all protections

**Required State:** 🟢 **SECURE**

- All write operations require permission checks
- All read operations filter by user access
- Role management requires admin permissions
- Audit trail for all permission checks

---

## 11. Next Steps

1. **Review this audit** with security team
2. **Prioritize fixes** based on business impact
3. **Implement permission checks** in phases:
   - Phase 1: Critical write operations (invoices, purchases, payments)
   - Phase 2: Other write operations (customers, items, expenses)
   - Phase 3: Read operations and reports
   - Phase 4: Role management and settings
4. **Test thoroughly** after each phase
5. **Add monitoring** for permission denials

---

**End of Audit Report**
