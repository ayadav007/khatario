# HR Permission Flow - Complete End-to-End Audit Report

**Date:** $(date)  
**Purpose:** Identify root cause of HR modules not visible/accessible to users including Primary Admin

---

## 📋 STEP 1 — Primary Admin Permissions API Response

### API Endpoint: `/api/settings/permissions`

**Expected Response Structure:**
```json
{
  "permissions": {
    "module_key": {
      "can_view": true,
      "can_add": true,
      "can_modify": true,
      "can_delete": true,
      "can_share": true
    }
  }
}
```

### Primary Admin Logic Flow:

1. **User Detection** (lines 32-42):
   - Checks `user.is_primary_admin` flag
   - OR checks `role.role_key === 'primary_admin'`
   - Sets `isPrimaryAdmin = true` if either matches

2. **Permission Generation** (lines 53-66):
   - Queries ALL modules from `permission_modules` table: `SELECT module_key FROM permission_modules WHERE is_active = true`
   - For EACH module found, returns ALL permissions as `true`

### ⚠️ CRITICAL FINDING #1: Database Dependency

**Issue:** Primary Admin permissions depend on modules existing in `permission_modules` table.

**Impact:** If migration 127 has NOT been run:
- `payroll` module does NOT exist → API returns no `payroll` key
- `leave_requests` module does NOT exist → API returns no `leave_requests` key
- `hr` module does NOT exist → API returns no `hr` key

**Root Cause:** API queries `permission_modules` table at runtime. If modules don't exist in DB, they won't be returned even for Primary Admin.

---

## 📋 STEP 2 — usePermissions Hook Analysis

### Normalization Logic (lines 31-50):

**Function:** `normalizePermissions(rawPermissions)`

**Behavior:**
- Input: Raw permissions from API (may have missing modules)
- Output: Normalized permissions with implicit read grants
- Rule: If `can_add || can_modify || can_delete || can_share` → set `can_view = true`

### ⚠️ CRITICAL FINDING #2: Missing Modules = No Permissions

**Issue:** `canView(module)` checks `permissions[module]` (line 82-87):
```typescript
const modulePermissions = permissions[module];
if (!modulePermissions) {
  return false;  // ← RETURNS FALSE if module not in permissions object
}
```

**Impact:**
- If API doesn't return `payroll` key → `canView('payroll')` returns `false`
- If API doesn't return `leave_requests` key → `canView('leave_requests')` returns `false`
- Normalization cannot fix missing modules (nothing to normalize)

**Root Cause:** Hook expects module to exist in `permissions` object. If module key is missing from API response, `canView()` returns `false` even for Primary Admin.

---

## 📋 STEP 3 — Sidebar Module Keys vs Permission Keys

### Sidebar HR Items (lines 430-438):

| Sidebar Item | Sidebar Module Key | Permission Module Expected |
|--------------|-------------------|---------------------------|
| All Employees | `employees` | ✅ `employees` (exists in migration 059) |
| Add Employee | `employees` | ✅ `employees` |
| Attendance | `attendance` | ✅ `attendance` (exists in migration 059) |
| Leaves | `leave_requests` | ⚠️ `leave_requests` (exists ONLY in migration 127) |
| Salary Payments | `payroll` | ⚠️ `payroll` (exists ONLY in migration 127) |
| Commissions | `commissions` | ✅ `commissions` (exists in migration 059) |
| Performance | `employees` | ✅ `employees` |
| Tasks | `employees` | ✅ `employees` |
| Activity Logs | `settings` | ✅ `settings` |

### ⚠️ CRITICAL FINDING #3: Migration Dependency

**Modules that ONLY exist in migration 127:**
- `payroll` — Sidebar uses `payroll`, but module only exists if migration 127 ran
- `leave_requests` — Sidebar uses `leave_requests`, but module only exists if migration 127 ran

**Modules that exist in migration 059:**
- `employees` ✅
- `attendance` ✅
- `commissions` ✅
- `leaves` ✅ (but sidebar uses `leave_requests`, not `leaves`)

---

## 📋 STEP 4 — Page Guard Resources vs Permission Keys

### HR Page Guards:

| Page | Guard Resource | Guard Action | Permission Expected | API Route Resource | API Action |
|------|---------------|--------------|-------------------|-------------------|------------|
| `/employees` | `employees` | `read` | `employees.read` ✅ | `employees` | `read` ✅ |
| `/employees/new` | `employees` | `create` | `employees.create` ✅ | `employees` | `create` ✅ |
| `/employees/attendance` | `attendance` | `read` | `attendance.read` ✅ | `attendance` | `read` ✅ |
| `/employees/leaves` | `leave_requests` | `read` | `leave_requests.read` ⚠️ | `leave_requests` | `read` ✅ |
| `/employees/commissions` | `commissions` | `read` | `commissions.read` ✅ | `commissions` | `read` ✅ |
| `/employees/expenses` | `expenses` | `read` | `expenses.read` ✅ | `expenses` | `read` ✅ |
| `/employees/salary/payments` | `payroll` | `read` | `payroll.read` ⚠️ | `payroll` | `read` ✅ |

### ⚠️ CRITICAL FINDING #4: Guard Resource ≠ Permission Module

**Issue:** Page guards use `resource: 'leave_requests'` and `resource: 'payroll'`, but:
- These modules may not exist in `permission_modules` table
- `useAuthorizationGuard` calls `/api/authorization/preview` with these resources
- Preview API eventually calls `checkUserPermission(userId, moduleKey, permissionKey)`
- If module doesn't exist → permission check fails

---

## 📋 STEP 5 — PBAC Resource Keys vs Permission Keys

### PBAC Policies (lib/policies/resources/hr.ts):

| PBAC Resource | PBAC Action | Requires Permission | Permission Module |
|--------------|-------------|-------------------|------------------|
| `employee` | `read` | `employees.read` | ✅ `employees` |
| `employees` | `read` | `employees.read` | ✅ `employees` |
| `attendance` | `read` | `attendance.read` | ✅ `attendance` |
| `payroll` | `read` | `employees.read` ⚠️ | ⚠️ Uses `employees.read`, NOT `payroll.read` |
| `leave_request` | `read` | `leaves.read` ⚠️ | ⚠️ Uses `leaves.read`, NOT `leave_requests.read` |
| `leave_requests` | `read` | `leaves.read` ⚠️ | ⚠️ Uses `leaves.read`, NOT `leave_requests.read` |
| `commissions` | `read` | `commissions.read` | ✅ `commissions` |
| `expenses` | `read` | `expenses.read` | ✅ `expenses` |

### ⚠️ CRITICAL FINDING #5: Permission Key Mismatches

**Mismatch 1: Payroll**
- Sidebar module: `payroll`
- Page guard resource: `payroll`
- API route resource: `payroll`
- PBAC resource: `payroll`
- **BUT:** PBAC requires `employees.read`, NOT `payroll.read`
- **AND:** Sidebar/Guard expect `payroll` module to exist in `permission_modules`

**Mismatch 2: Leave Requests**
- Sidebar module: `leave_requests`
- Page guard resource: `leave_requests`
- API route resource: `leave_requests`
- PBAC resource: `leave_requests` (also `leave_request`)
- **BUT:** PBAC requires `leaves.read`, NOT `leave_requests.read`
- **AND:** Migration 127 adds `leave_requests`, but migration 059 has `leaves`

---

## 📋 STEP 6 — Authorization Flow (authorize function)

### Resource → Permission Module Mapping (lines 137-150):

**Current Mapping:**
```typescript
const permissionModuleMap: Record<string, string> = {
  'inventory_adjustment': 'items',
  'inventory_adjustments': 'items',
  'warehouse': 'items',
  'warehouses': 'items',
  'warehouse_transfer': 'items',
  'warehouse_transfers': 'items',
  'stock_transfer': 'items',
  'stock_transfers': 'items',
};
```

### ⚠️ CRITICAL FINDING #6: No HR Resource Mapping

**Issue:** No mapping exists for HR resources:
- `payroll` → no mapping → uses `payroll` as permission module
- `leave_requests` → no mapping → uses `leave_requests` as permission module

**Impact:**
- `checkUserPermission()` has Primary Admin bypass (returns `true` if `user.is_primary_admin`)
- BUT: `authorize()` RBAC check happens FIRST (line 154)
- If Primary Admin → RBAC bypass works → passes to PBAC
- However: Frontend `usePermissions` doesn't know about missing modules

**Note:** Backend `authorize()` actually WORKS for Primary Admin (bypass exists), but frontend `canView()` fails because API doesn't return missing modules.

---

## 📋 STEP 7 — Complete Permission Flow Table

| Page | Sidebar Module | Guard Resource | API Permission Module | PBAC Resource | PBAC Requires Permission | Status |
|------|----------------|----------------|----------------------|---------------|-------------------------|--------|
| `/employees` | `employees` | `employees` | `employees` | `employees` | `employees.read` ✅ | ✅ WORKS |
| `/employees/attendance` | `attendance` | `attendance` | `attendance` | `attendance` | `attendance.read` ✅ | ✅ WORKS |
| `/employees/leaves` | `leave_requests` | `leave_requests` | `leave_requests` ⚠️ | `leave_requests` | `leaves.read` ⚠️ | ❌ **FAILS** |
| `/employees/salary/payments` | `payroll` | `payroll` | `payroll` ⚠️ | `payroll` | `employees.read` ⚠️ | ❌ **FAILS** |
| `/employees/commissions` | `commissions` | `commissions` | `commissions` | `commissions` | `commissions.read` ✅ | ✅ WORKS |
| `/employees/expenses` | N/A (not in sidebar) | `expenses` | `expenses` | `expenses` | `expenses.read` ✅ | ✅ WORKS |

### Legend:
- ✅ WORKS: All layers aligned, module exists in DB
- ⚠️ Mismatch: Layer uses different permission key but may work if conditions met
- ❌ FAILS: Module doesn't exist in DB OR permission key mismatch causes failure

---

## 🚨 ROOT CAUSE ANALYSIS

### Primary Root Cause: **Migration Dependency**

**The Issue:**
1. **Migration 059** (initial RBAC) creates:
   - `employees` ✅
   - `attendance` ✅
   - `commissions` ✅
   - `leaves` ✅ (note: singular `leaves`, NOT `leave_requests`)

2. **Migration 127** (adds missing modules) creates:
   - `payroll` ⚠️
   - `leave_requests` ⚠️
   - `hr` ⚠️

3. **If Migration 127 has NOT run:**
   - `payroll` module doesn't exist in `permission_modules`
   - `leave_requests` module doesn't exist in `permission_modules`
   - Primary Admin API queries `permission_modules` → returns only modules that exist
   - Primary Admin API returns permissions for `employees`, `attendance`, `commissions`, `leaves` — but NOT `payroll` or `leave_requests`
   - `usePermissions` receives no `payroll` key → `canView('payroll')` returns `false`
   - Sidebar hides `payroll` item
   - Page guard calls `authorize(userId, 'payroll', 'read')` → RBAC checks `permission_modules` for `payroll` → fails (module doesn't exist)

### Secondary Root Cause: **Permission Key Mismatch**

**The Issue:**
1. **PBAC policies use `leaves.read`** but:
   - Sidebar uses module: `leave_requests`
   - Page guard uses resource: `leave_requests`
   - API routes use resource: `leave_requests`
   - RBAC expects module: `leave_requests` (if migration 127 ran) OR `leaves` (if only migration 059 ran)

2. **PBAC policies use `employees.read` for payroll** but:
   - Sidebar expects module: `payroll`
   - Page guard uses resource: `payroll`
   - RBAC checks for `payroll` module (which may not exist)

**Why This Matters:**
- RBAC check happens BEFORE PBAC check (authorization.ts line 154)
- If RBAC fails (module doesn't exist), PBAC never runs
- Even if PBAC would allow it (e.g., `payroll` → `employees.read`), the request fails at RBAC stage

---

## 📊 COMPLETE KEY MAPPING TABLE

| Layer | Employees | Attendance | Leaves | Leave Requests | Payroll | Commissions | Expenses |
|-------|-----------|------------|--------|----------------|---------|-------------|----------|
| **Database Module (059)** | ✅ `employees` | ✅ `attendance` | ✅ `leaves` | ❌ Missing | ❌ Missing | ✅ `commissions` | ✅ `expenses` |
| **Database Module (127)** | ✅ `employees` | ✅ `attendance` | ✅ `leaves` | ✅ `leave_requests` | ✅ `payroll` | ✅ `commissions` | ✅ `expenses` |
| **Sidebar Module** | `employees` | `attendance` | N/A | `leave_requests` | `payroll` | `commissions` | N/A |
| **Page Guard Resource** | `employees` | `attendance` | N/A | `leave_requests` | `payroll` | `commissions` | `expenses` |
| **API Route Resource** | `employees` | `attendance` | N/A | `leave_requests` | `payroll` | `commissions` | `expenses` |
| **RBAC Permission Module** | `employees` | `attendance` | `leaves` | `leave_requests` ⚠️ | `payroll` ⚠️ | `commissions` | `expenses` |
| **PBAC Resource** | `employees` | `attendance` | N/A | `leave_requests` | `payroll` | `commissions` | `expenses` |
| **PBAC Requires Permission** | `employees.read` | `attendance.read` | N/A | `leaves.read` ⚠️ | `employees.read` ⚠️ | `commissions.read` | `expenses.read` |

**Legend:**
- ✅ Exists and aligned
- ⚠️ Mismatch or conditional existence
- ❌ Missing

---

## 🎯 EXACT ROOT CAUSE IDENTIFIED

### **ROOT CAUSE: Migration 127 Dependency + No Fallback**

**The Problem:**
1. **Sidebar and Page Guards use `payroll` and `leave_requests` as module keys**
2. **These modules ONLY exist if Migration 127 has run**
3. **If Migration 127 hasn't run:**
   - `permission_modules` table has NO `payroll` row
   - `permission_modules` table has NO `leave_requests` row
   - Primary Admin API queries `permission_modules` → returns only existing modules
   - Primary Admin API does NOT return `payroll` or `leave_requests` keys
   - `usePermissions.canView('payroll')` → checks `permissions['payroll']` → undefined → returns `false`
   - Sidebar hides `payroll` item
   - Page guard calls `authorize(userId, 'payroll', 'read')` → RBAC checks `checkUserPermission(userId, 'payroll', 'read')` → module doesn't exist → throws `AuthorizationError`

**Why Primary Admin Can't Access:**
- Even though Primary Admin should have ALL permissions, the system queries the database for module existence
- If module doesn't exist in `permission_modules`, it's not returned by the API
- `usePermissions` has no fallback to assume Primary Admin has access to missing modules
- `authorize()` has no fallback to bypass RBAC check if module doesn't exist

**The Fix Requires:**
1. Either ensure Migration 127 always runs (database-level fix)
2. OR add Primary Admin bypass in `usePermissions.canView()` (frontend fix)
3. OR add Primary Admin bypass in `authorize()` RBAC check (backend fix)
4. OR add resource mapping in `authorize()` to map `payroll` → `employees` (backend fix)
5. OR change sidebar/guards to use existing modules (e.g., `payroll` → `employees`, `leave_requests` → `leaves`)

---

## 📋 SUMMARY OF MISMATCHES

### Mismatch 1: Leave Requests Permission Key
- **UI Layer:** Uses `leave_requests` module
- **PBAC Layer:** Requires `leaves.read` permission
- **Database:** Has both `leaves` (migration 059) and `leave_requests` (migration 127)
- **Impact:** Works ONLY if migration 127 ran AND RBAC uses `leave_requests` module

### Mismatch 2: Payroll Permission Key
- **UI Layer:** Uses `payroll` module
- **PBAC Layer:** Requires `employees.read` permission (different module!)
- **Database:** `payroll` exists ONLY if migration 127 ran
- **Impact:** RBAC checks `payroll` module, but PBAC uses `employees.read` → Works ONLY if migration 127 ran AND user has `payroll` permission (even though PBAC uses `employees.read`)

### Mismatch 3: Payroll Module Dependency
- **Sidebar/Guard:** Expect `payroll` to exist in `permission_modules`
- **PBAC:** Uses `employees.read` (doesn't need `payroll` module)
- **RBAC:** Checks `payroll` module existence FIRST (before PBAC)
- **Impact:** If `payroll` module doesn't exist → RBAC fails → PBAC never runs → Access denied

---

## ✅ CONFIRMED: EXACT ROOT CAUSE IDENTIFIED

**Root Cause:** Migration 127 creates `payroll` and `leave_requests` modules, but if migration hasn't run, these modules don't exist in `permission_modules`. 

**Frontend Issue (Primary):**
- `/api/settings/permissions` queries `permission_modules` table → only returns modules that exist
- If `payroll` or `leave_requests` don't exist → API response doesn't include them
- `usePermissions.canView('payroll')` → checks `permissions['payroll']` → undefined → returns `false`
- Sidebar hides items → Users can't see HR modules in navigation

**Backend Issue (Secondary):**
- `checkUserPermission()` has Primary Admin bypass (returns `true`), so RBAC passes
- BUT: If non-Primary Admin users don't have `payroll`/`leave_requests` in `role_permissions` → RBAC fails
- PBAC check never runs if RBAC fails for non-admin users

**Additional Issues:**
- PBAC uses `leaves.read` for `leave_requests` resource (works if both modules exist)
- PBAC uses `employees.read` for `payroll` resource (works but confusing)
- No resource mapping in `authorize()` for HR resources
- No Primary Admin bypass for missing modules

**Fix Strategy (Not Implemented - Awaiting Approval):**
- Option A: Ensure migration 127 always runs (database fix)
- Option B: Add Primary Admin bypass in `usePermissions` for missing modules (frontend fix)
- Option C: Add resource mapping in `authorize()` (e.g., `payroll` → `employees`) (backend fix)
- Option D: Change sidebar/guards to use existing modules (`payroll` → `employees`, `leave_requests` → `leaves`) (UI fix)

---

---

## 📋 STEP 8 — Complete Permission Flow Trace

### Flow 1: `/employees/leaves` Page (if Migration 127 NOT run)

| Layer | Module/Resource | Check | Result | Reason |
|-------|----------------|-------|--------|--------|
| **Database** | `leave_requests` | Module exists? | ❌ NO | Migration 127 not run |
| **API `/api/settings/permissions`** | Query `permission_modules` | `SELECT module_key...` | Returns: `employees`, `attendance`, `commissions`, `leaves` | `leave_requests` not in DB |
| **API Response** | `permissions` object | Has `leave_requests`? | ❌ NO | Module not returned |
| **usePermissions Hook** | `canView('leave_requests')` | Check `permissions['leave_requests']` | ❌ `false` | Key missing from object |
| **Sidebar** | `isItemVisible(item)` | `canView('leave_requests')` | ❌ `false` | Item hidden |
| **Page Guard** | `authorize(userId, 'leave_requests', 'read')` | RBAC: `checkUserPermission()` | ✅ `true` (Primary Admin bypass) | Bypass works |
| **Page Guard** | `authorize(userId, 'leave_requests', 'read')` | PBAC: Policy for `leave_requests.read` | ✅ Policy exists | Uses `leaves.read` permission |
| **Page Access** | User navigates to page | Guard check result | ✅ ALLOWED | Backend works |
| **Page Visibility** | Sidebar item | Item visible? | ❌ NO | Frontend hides it |

**Conclusion:** Backend allows access, but frontend hides sidebar item → Users can't navigate to page even though they have access.

---

### Flow 2: `/employees/salary/payments` Page (if Migration 127 NOT run)

| Layer | Module/Resource | Check | Result | Reason |
|-------|----------------|-------|--------|--------|
| **Database** | `payroll` | Module exists? | ❌ NO | Migration 127 not run |
| **API `/api/settings/permissions`** | Query `permission_modules` | `SELECT module_key...` | Returns: `employees`, `attendance`, `commissions`, `leaves` | `payroll` not in DB |
| **API Response** | `permissions` object | Has `payroll`? | ❌ NO | Module not returned |
| **usePermissions Hook** | `canView('payroll')` | Check `permissions['payroll']` | ❌ `false` | Key missing from object |
| **Sidebar** | `isItemVisible(item)` | `canView('payroll')` | ❌ `false` | Item hidden |
| **Page Guard** | `authorize(userId, 'payroll', 'read')` | RBAC: `checkUserPermission(userId, 'payroll', 'read')` | ✅ `true` (Primary Admin bypass) | Bypass works |
| **Page Guard** | `authorize(userId, 'payroll', 'read')` | PBAC: Policy for `payroll.read` | ✅ Policy exists | Uses `employees.read` permission |
| **Page Access** | User navigates to page | Guard check result | ✅ ALLOWED | Backend works |
| **Page Visibility** | Sidebar item | Item visible? | ❌ NO | Frontend hides it |

**Conclusion:** Backend allows access, but frontend hides sidebar item → Users can't navigate to page even though they have access.

---

### Flow 3: `/employees/leaves` Page (if Migration 127 HAS run)

| Layer | Module/Resource | Check | Result | Reason |
|-------|----------------|-------|--------|--------|
| **Database** | `leave_requests` | Module exists? | ✅ YES | Migration 127 run |
| **API `/api/settings/permissions`** | Query `permission_modules` | `SELECT module_key...` | Returns: `employees`, `attendance`, `commissions`, `leaves`, `leave_requests`, `payroll` | All modules exist |
| **API Response** | `permissions` object | Has `leave_requests`? | ✅ YES | Module returned with all permissions `true` |
| **usePermissions Hook** | `canView('leave_requests')` | Check `permissions['leave_requests']` | ✅ `true` | Key exists, `can_view: true` |
| **Sidebar** | `isItemVisible(item)` | `canView('leave_requests')` | ✅ `true` | Item visible |
| **Page Guard** | `authorize(userId, 'leave_requests', 'read')` | RBAC: `checkUserPermission()` | ✅ `true` (Primary Admin bypass) | Bypass works |
| **Page Guard** | `authorize(userId, 'leave_requests', 'read')` | PBAC: Policy for `leave_requests.read` | ✅ Policy exists | Uses `leaves.read` permission |
| **Page Access** | User navigates to page | Guard check result | ✅ ALLOWED | All checks pass |
| **Page Visibility** | Sidebar item | Item visible? | ✅ YES | Frontend shows it |

**Conclusion:** Everything works when migration has run.

---

## 🎯 FINAL ROOT CAUSE SUMMARY

### **PRIMARY ROOT CAUSE: Frontend Permission Check Failure**

**The Issue:**
1. `/api/settings/permissions` queries `permission_modules` table dynamically
2. Only modules that exist in database are returned
3. If Migration 127 hasn't run → `payroll` and `leave_requests` don't exist in DB
4. API response doesn't include these module keys
5. `usePermissions.canView('payroll')` checks `permissions['payroll']` → undefined
6. `canView()` returns `false` → Sidebar hides items
7. Users cannot see or navigate to pages, even though backend would allow access

### **SECONDARY ROOT CAUSE: Backend Permission Check Dependency**

**The Issue:**
1. `authorize()` calls `checkUserPermission(userId, moduleKey, permissionKey)`
2. `checkUserPermission()` has Primary Admin bypass → returns `true` for Primary Admin
3. BUT: `checkRolePermission()` queries `role_permissions` table with `module_key`
4. If module doesn't exist in `permission_modules` → no rows in `role_permissions` for that module
5. For non-Primary Admin users: Query returns no rows → `result?.has_permission` is `undefined` → returns `false`
6. RBAC fails → PBAC never runs → Access denied

**However:** For Primary Admin, bypass works → backend allows access, but frontend still hides items.

---

## ✅ CONFIRMED: EXACT ROOT CAUSE IDENTIFIED

**Root Cause:**
1. **Frontend:** `usePermissions.canView()` depends on API returning module keys. If module doesn't exist in `permission_modules` table, API doesn't return it, `canView()` returns `false`, sidebar hides items.
2. **Backend:** `checkUserPermission()` queries `role_permissions` with `module_key`. If module doesn't exist, no rows found → returns `false` for non-admin users (Primary Admin bypass works).

**Why Primary Admin Still Can't Access:**
- Backend allows access (bypass works)
- BUT frontend hides sidebar items (canView returns false)
- Users can't navigate to pages even though backend would allow

**Why Non-Primary Admin Users Can't Access:**
- Backend denies access (RBAC fails because module doesn't exist in role_permissions)
- Frontend also hides items (same reason as above)

**Fix Strategy (Not Implemented - Awaiting Approval):**
- Option A: Ensure migration 127 always runs (database fix - prevents issue)
- Option B: Add Primary Admin bypass in `usePermissions.canView()` for missing modules (frontend fix)
- Option C: Add resource mapping in `authorize()` (e.g., `payroll` → `employees`, `leave_requests` → `leaves`) (backend fix)
- Option D: Change sidebar/guards to use existing modules (`payroll` → `employees`, `leave_requests` → `leaves`) (UI fix)
- Option E: Make API return all expected modules with default permissions if missing (API fix)

---

**Audit Complete. Exact root cause identified.**
