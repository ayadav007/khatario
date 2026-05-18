# Security Audit Report: Roles, Permissions, and Employee Access

**Date:** 2024  
**Auditor:** Senior SaaS Security Architect  
**Scope:** Full system audit of roles, permissions, and employee access boundaries

---

## Executive Summary

This audit examines the identity model, role/permission enforcement, user creation flows, employee boundaries, and UI/backend consistency. The system uses a hybrid RBAC/PBAC model with subscription-based feature enforcement.

**Key Findings:**
- ✅ **STRENGTH:** Centralized authorization layer (`lib/authorization.ts`)
- ⚠️ **CRITICAL:** Login route does NOT check employee `access_type` - employees with `access_type='full'` can access portal
- ⚠️ **HIGH:** Some APIs check subscription but NOT permission
- ⚠️ **MEDIUM:** Users can exist without `role_id` (enforced only in `checkUserPermission`, not at creation)
- ⚠️ **MEDIUM:** Employee/User boundary is blurred - employees extend users table

---

## 1. Identity Model

### 1.1 Users vs Employees

**Database Schema:**
- **Users Table** (`users`): Core identity table
  - Fields: `id`, `business_id`, `name`, `email`, `phone`, `password_hash`, `role`, `permissions` (JSONB), `role_id`, `is_primary_admin`, `is_active`
  - Location: `database/schema.sql:59-71`
  
- **Employees Table** (`employees`): Extends users
  - Fields: `id` (FK to `users.id`), `business_id`, `employee_code`, `access_type` ('full' | 'attendance_only'), `designation`, `department`, etc.
  - Location: `database/migrations/054_employee_management.sql:5-28`
  - **CRITICAL:** `employees.id` REFERENCES `users.id` ON DELETE CASCADE

**Key Finding:**
- Employees ARE users (1:1 relationship via FK)
- Employee record cannot exist without corresponding user record
- This creates a **blurred boundary** between portal users and staff records

### 1.2 Authentication Flows

#### Portal User Authentication
- **Endpoint:** `POST /api/auth/login`
- **Location:** `app/api/auth/login/route.ts:15-138`
- **Method:** Phone + password
- **Process:**
  1. Normalize phone number
  2. Query `users` table by phone
  3. Verify password (bcrypt or legacy plaintext)
  4. Update `last_active_at`
  5. Return user + business data

**CRITICAL FINDING:**
- **Line 56-62:** Login queries `users` table ONLY
- **NO CHECK** for employee `access_type`
- **NO CHECK** if user is an employee
- **Impact:** Employees with `access_type='full'` can login via portal login
- **Risk:** Employees may access portal APIs if they have `role_id` assigned

#### Employee Attendance Authentication
- **Endpoint:** `POST /api/attendance/send-otp` → `POST /api/attendance/verify-otp`
- **Location:** `app/api/attendance/send-otp/route.ts`, `app/api/attendance/verify-otp/route.ts`
- **Method:** Phone + OTP (6-digit, 10-minute expiry)
- **Process:**
  1. Find employee by phone + business_id
  2. **CHECK:** `access_type === 'attendance_only'` (Line 38 in send-otp)
  3. Generate OTP
  4. Create `attendance_sessions` record
  5. Return session_token

**Finding:**
- ✅ Attendance login correctly enforces `access_type='attendance_only'`
- ✅ Rejects employees with `access_type='full'` (Line 38-42)
- ⚠️ **Gap:** Employees with `access_type='full'` can bypass attendance-only restriction by using portal login

#### Platform Admin Authentication
- **Endpoint:** `POST /api/admin/auth/login`
- **Location:** `app/api/admin/auth/login/route.ts:8-66`
- **Method:** Email + password
- **Separate System:** Uses `platform_admins` table (not `users`)

---

## 2. Role & Permission Enforcement

### 2.1 Permission System Architecture

**Two-Layer System:**
1. **RBAC (Role-Based Access Control):**
   - Location: `lib/permissions.ts`
   - Tables: `user_roles`, `role_permissions`, `permission_modules`
   - Function: `checkUserPermission(userId, moduleKey, permissionKey)`
   - **Finding:** Returns `false` if user has no `role_id` (Line 113-117)

2. **PBAC (Policy-Based Access Control):**
   - Location: `lib/authorization.ts`, `lib/policies/`
   - Function: `authorize(userId, moduleKey, action, context)`
   - Process:
     - Step 1: RBAC check (Line 167)
     - Step 2: Branch/Warehouse access (Line 185-208)
     - Step 3: PBAC policy evaluation (Line 214-427)
   - **Default Behavior:** Default-deny if no policy defined (Line 235-255)

### 2.2 Permission Enforcement Points

**Central Authorization:**
- **File:** `lib/authorization.ts:81-430`
- **Function:** `authorize(userId, moduleKey, action, context)`
- **Usage:** 152 API endpoints use `authorize()` (grep results)

**Permission Check Function:**
- **File:** `lib/permissions.ts:65-136`
- **Function:** `checkUserPermission(userId, moduleKey, permissionKey)`
- **Key Logic:**
  - Line 77-80: Query user's `role_id`
  - Line 95-111: If no `role_id` but `is_primary_admin`, lookup `primary_admin` role
  - Line 113-117: **Returns `false` if no `role_id`** (even for primary admin without role)
  - Line 124: Check `role_permissions` table

**CRITICAL FINDING:**
- Users without `role_id` will fail permission checks
- Primary admin lookup only works if `primary_admin` role exists
- **No enforcement at user creation** that `role_id` is mandatory

### 2.3 API Enforcement Patterns

#### Pattern 1: Permission + Subscription (CORRECT)
**Example:** `app/api/customers/route.ts:126-148`
```typescript
// Line 128: Permission check
await authorize(created_by, 'customers', 'create');
// Line 137: Subscription limit check
const limitCheck = await checkLimit(business_id, 'customers');
```

**Files with BOTH checks:**
- `app/api/customers/route.ts` (POST)
- `app/api/employees/route.ts` (POST)
- `app/api/employees/attendance/route.ts` (POST)
- `app/api/employees/leave-balances/route.ts` (POST)
- `app/api/bank-accounts/route.ts` (POST)
- `app/api/categories/route.ts` (POST)
- `app/api/branches/route.ts` (POST)

#### Pattern 2: Permission ONLY (MISSING SUBSCRIPTION)
**Example:** `app/api/items/route.ts:117-125`
```typescript
// Line 119: Permission check
await authorize(created_by, 'items', 'create');
// NO subscription limit check
```

**Files with PERMISSION ONLY:**
- `app/api/items/route.ts` (POST) - **HIGH RISK**
- `app/api/invoices/route.ts` (POST) - **HIGH RISK**
- `app/api/purchases/route.ts` (POST) - **HIGH RISK**
- `app/api/credit-notes/route.ts` (POST) - **HIGH RISK**
- `app/api/expenses/route.ts` (POST) - **HIGH RISK**
- `app/api/payments/route.ts` (POST) - **HIGH RISK**
- `app/api/journal-entries/route.ts` (POST) - **HIGH RISK**
- `app/api/work-orders/route.ts` (POST) - **HIGH RISK**
- `app/api/stock-transfers/route.ts` (POST) - **HIGH RISK**
- `app/api/warehouses/route.ts` (POST) - **HIGH RISK**
- `app/api/inventory-adjustments/route.ts` (POST) - **HIGH RISK**
- `app/api/accounts/route.ts` (POST) - **HIGH RISK**
- `app/api/debit-notes/route.ts` (POST) - **HIGH RISK**

**Impact:** Users can create unlimited resources if they have permission, bypassing subscription limits.

#### Pattern 3: Subscription ONLY (MISSING PERMISSION)
**Example:** `app/api/invoices/[id]/email/route.ts`
```typescript
// Line: Feature access check
await assertFeatureAccess(invoice.business_id, FeatureKeys.INTEGRATION_EMAIL_INVOICING);
// NO permission check
```

**Files with SUBSCRIPTION ONLY:**
- `app/api/invoices/[id]/email/route.ts` (POST) - **HIGH RISK**
- `app/api/invoices/[id]/pdf/route.ts` (GET) - **MEDIUM RISK**
- `app/api/invoices/[id]/preview/route.ts` (GET) - **MEDIUM RISK**
- `app/api/reports/*/route.ts` (Multiple) - **MEDIUM RISK** (Some have both, some don't)

**Impact:** Any user with subscription access can use these features, regardless of role permissions.

#### Pattern 4: NEITHER (CRITICAL)
**Finding:** No APIs found with NEITHER check (all critical endpoints have at least one)

---

## 3. User Creation & Role Assignment

### 3.1 User Creation Flows

#### Flow 1: Business Signup (Primary Admin)
**File:** `app/api/signup/route.ts:144-152`
```typescript
// Line 148: User created WITH role_id
INSERT INTO users (business_id, name, phone, password_hash, role_id, is_primary_admin) 
VALUES ($1, $2, $3, $4, $5, true)
```
- ✅ **Role is mandatory** - `primaryAdminRoleId` is created before user (Line 94-108)
- ✅ **All permissions assigned** to primary_admin role (Line 110-120)

#### Flow 2: Admin Creates User
**File:** `app/api/settings/users/route.ts:196-207`
```typescript
// Line 200: User created WITH role_id
INSERT INTO users (
  business_id, name, email, phone, password_hash, role_id,
  is_primary_admin, allow_multidevice_sync, is_active
)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, true)
```
- ✅ **Role validation** - Checks role belongs to business (Line 171-181)
- ✅ **Permission check** - `authorize(created_by_user_id, 'settings', 'create')` (Line 120)
- ⚠️ **Gap:** `role_id` can be NULL if not provided (no NOT NULL constraint)

#### Flow 3: Employee Creation
**File:** `app/api/employees/route.ts:233-250`
```typescript
// Line 240: User created (may have role_id if access_type='full')
INSERT INTO users (
  business_id, name, email, phone, password_hash, role_id, is_active
)
VALUES ($1, $2, $3, $4, $5, $6, true)
```
- ✅ **Permission check** - `authorize(created_by_user_id, 'employees', 'create')` (Line 186)
- ✅ **Subscription limit check** - `checkLimit(business_id, 'employees')` (Line 195)
- ⚠️ **Gap:** `role_id` is optional (Line 166: `role_id, // Optional`)
- ⚠️ **Gap:** If `access_type='full'` but no `role_id`, user can login but has no permissions

### 3.2 Role Assignment Enforcement

**Database Constraint:**
- `users.role_id` is **NOT NULL** in schema? **NO** - No NOT NULL constraint found
- `users.role_id` can be NULL

**Code Enforcement:**
- `lib/permissions.ts:113-117`: Returns `false` if no `role_id`
- `app/api/settings/users/fix-roles/route.ts`: Utility to fix users without roles

**CRITICAL FINDING:**
- Users CAN exist without `role_id`
- Permission checks will fail for these users
- **No enforcement at creation** that `role_id` is mandatory
- **Bootstrap mode bypass** in `authorize()` (Line 116-137) allows `settings.create` when business has zero roles

---

## 4. Employee Boundaries

### 4.1 Employee Access Types

**Schema:** `employees.access_type` ('full' | 'attendance_only')
- **'full':** Full portal access (should use portal login)
- **'attendance_only':** Only attendance marking (OTP-based)

### 4.2 Employee API Access

#### Attendance APIs (Employee-Only)
**Endpoints:**
- `POST /api/attendance/send-otp`
- `POST /api/attendance/verify-otp`
- `POST /api/attendance/verify-session`
- `POST /api/employees/attendance/check-in`
- `POST /api/employees/attendance/check-out`

**Enforcement:**
- ✅ Attendance OTP login checks `access_type='attendance_only'` (Line 38 in send-otp)
- ✅ Session-based access uses `attendance_sessions` table
- ⚠️ **Gap:** No check that employee is NOT accessing portal APIs

#### Portal APIs (User-Only, Should Exclude Employees)
**Finding:** NO explicit check to prevent employees from accessing portal APIs

**Example:** `app/api/invoices/route.ts`
- Checks `authorize(created_by, 'invoices', 'create')`
- Does NOT check if `created_by` is an employee
- **Impact:** Employee with `access_type='full'` + `role_id` can create invoices

### 4.3 Shared Authentication Logic

**CRITICAL FINDING:**
- `app/api/auth/login/route.ts` does NOT distinguish employees from users
- Employees with `access_type='full'` can login via portal login
- Employees with `role_id` assigned will pass permission checks
- **Boundary is blurred** - employees ARE users in the system

**Recommendation:**
- Add check in login route: If user is employee with `access_type='attendance_only'`, reject portal login
- OR: Add middleware to reject employee access to portal APIs

---

## 5. UI vs Backend Consistency

### 5.1 Sidebar Permission Logic

**File:** `components/layout/Sidebar.tsx:42-52`
```typescript
const featureRegistry = useFeatureRegistry(); // Feature Registry hook
const { canView, loading: permissionsLoading, permissions } = usePermissions();
```

**Permission Check:**
- Uses `usePermissions()` hook (Line 52)
- Checks `canView(moduleKey)` for sidebar items
- **Location:** `hooks/usePermissions.ts` (not shown, but referenced)

**Feature Check:**
- Uses `useFeatureRegistry()` hook (Line 51)
- Checks `hasFeature(featureKey)` for feature locks (Line 201-243)
- **Location:** `hooks/useFeatureRegistry.ts`

**Finding:**
- ✅ Sidebar checks BOTH permissions AND features
- ✅ Uses canonical feature keys (`normalizeFeatureKey`)
- ⚠️ **Gap:** If backend API doesn't check permission, UI lock can be bypassed

### 5.2 Route Guards

**File:** `hooks/useFeatureRouteGuard.ts`, `components/guards/FeatureRouteGuard.tsx`
- Checks feature access before rendering page
- Uses canonical feature keys
- **Gap:** Does NOT check permissions (only features)

**Finding:**
- Route guards check subscription features
- Route guards do NOT check role permissions
- **Impact:** User with subscription but no permission can access page (will fail at API level)

---

## 6. Risk Classification

### CRITICAL (Security Violation)

#### C1: Login Route Does Not Check Employee Access Type
- **File:** `app/api/auth/login/route.ts:56-62`
- **Issue:** Login queries `users` table only, no check for employee `access_type`
- **Impact:** Employees with `access_type='attendance_only'` can login via portal if they know password
- **Risk:** Unauthorized access to portal features
- **Fix:** Add check: If user is employee with `access_type='attendance_only'`, reject login

#### C2: Employees Can Access Portal APIs
- **Files:** All portal API endpoints (e.g., `app/api/invoices/route.ts`)
- **Issue:** No check to prevent employees from accessing portal APIs
- **Impact:** Employee with `access_type='full'` + `role_id` can use all portal features
- **Risk:** Blurred boundary between employee and user access
- **Fix:** Add middleware or check in each API: Reject if user is employee (unless explicitly allowed)

### HIGH (Privilege Escalation)

#### H1: APIs Check Permission But Not Subscription Limits
- **Files:** See Pattern 2 list (13+ endpoints)
- **Issue:** Permission check passes, but subscription limits are not enforced
- **Impact:** Users can create unlimited resources if they have permission
- **Risk:** Bypass subscription tier limits
- **Fix:** Add `checkLimit()` call after permission check

#### H2: APIs Check Subscription But Not Permission
- **Files:** See Pattern 3 list (10+ endpoints)
- **Issue:** Feature access check passes, but role permission is not checked
- **Impact:** Any user with subscription can use features, regardless of role
- **Risk:** Privilege escalation (user without permission can use feature)
- **Fix:** Add `authorize()` call before feature check

#### H3: Users Can Exist Without Role
- **Files:** `app/api/settings/users/route.ts:200`, `app/api/employees/route.ts:240`
- **Issue:** `role_id` is optional in user creation
- **Impact:** Users without `role_id` will fail all permission checks
- **Risk:** Users created but unable to access system
- **Fix:** Make `role_id` mandatory (NOT NULL constraint + validation)

### MEDIUM (Inconsistent Enforcement)

#### M1: Primary Admin Role Lookup May Fail
- **File:** `lib/permissions.ts:95-111`
- **Issue:** If `primary_admin` role doesn't exist, lookup fails
- **Impact:** Primary admin without role will fail permission checks
- **Risk:** System lockout for primary admin
- **Fix:** Ensure `primary_admin` role always exists (already done in signup, but verify)

#### M2: Route Guards Don't Check Permissions
- **Files:** `hooks/useFeatureRouteGuard.ts`, `components/guards/FeatureRouteGuard.tsx`
- **Issue:** Route guards check features only, not permissions
- **Impact:** User sees page but API calls fail
- **Risk:** Poor UX (page loads but actions fail)
- **Fix:** Add permission check to route guards

#### M3: Bootstrap Mode Bypass
- **File:** `lib/authorization.ts:116-137`
- **Issue:** RBAC check is skipped for `settings.create` when business has zero roles
- **Impact:** Allows first-time setup
- **Risk:** Could be exploited if business has zero roles (unlikely but possible)
- **Fix:** Add explicit check that business is in setup mode

### LOW (Cleanup / Future Improvement)

#### L1: Legacy Permission System Still Used
- **File:** `lib/permissions.ts`
- **Issue:** Uses old `role_permissions` table with boolean flags
- **Impact:** Technical debt
- **Risk:** Low (system works, but could be modernized)

#### L2: Employee/User Boundary Is Blurred
- **Issue:** Employees extend users table (1:1 FK)
- **Impact:** Conceptual confusion
- **Risk:** Low (works but could be clearer)
- **Fix:** Consider separate authentication system for employees

---

## 7. Permission Enforcement Matrix

| Feature | Subscription Check | Permission Check | API Endpoint | Status |
|---------|-------------------|-----------------|--------------|--------|
| Invoice Creation | ✅ `assertFeatureAccess` | ✅ `authorize('invoices', 'create')` | `POST /api/invoices` | ✅ CORRECT |
| Customer Creation | ✅ `checkLimit('customers')` | ✅ `authorize('customers', 'create')` | `POST /api/customers` | ✅ CORRECT |
| Item Creation | ❌ MISSING | ✅ `authorize('items', 'create')` | `POST /api/items` | ⚠️ MISSING SUBSCRIPTION |
| Purchase Creation | ❌ MISSING | ✅ `authorize('purchases', 'create')` | `POST /api/purchases` | ⚠️ MISSING SUBSCRIPTION |
| Email Invoicing | ✅ `assertFeatureAccess` | ❌ MISSING | `POST /api/invoices/[id]/email` | ⚠️ MISSING PERMISSION |
| Reports (Advanced) | ✅ `assertReportAccess` | ✅ `authorize('report.financial', 'read')` | `GET /api/reports/profit-loss` | ✅ CORRECT |
| Employee Creation | ✅ `checkLimit('employees')` | ✅ `authorize('employees', 'create')` | `POST /api/employees` | ✅ CORRECT |
| Branch Creation | ❌ MISSING | ✅ `authorize('settings', 'create')` | `POST /api/branches` | ⚠️ MISSING SUBSCRIPTION |

---

## 8. Root Causes

### RC1: Missing Employee Boundary Enforcement
**Cause:** Employees extend users table, login route doesn't distinguish
**Impact:** Employees can access portal APIs
**Fix:** Add employee check in login route and/or API middleware

### RC2: Inconsistent Enforcement Patterns
**Cause:** Different developers implemented different patterns
**Impact:** Some APIs miss subscription checks, some miss permission checks
**Fix:** Standardize enforcement pattern (permission → subscription → feature)

### RC3: Optional Role Assignment
**Cause:** `role_id` is not enforced as NOT NULL
**Impact:** Users can exist without roles, failing all permission checks
**Fix:** Add NOT NULL constraint + validation

### RC4: Subscription vs Permission Confusion
**Cause:** Two separate systems (subscription features vs role permissions)
**Impact:** APIs check one but not the other
**Fix:** Clarify: Subscription = "can business use feature?", Permission = "can user perform action?"

---

## 9. Recommendations

### Immediate Actions (CRITICAL)

1. **Add Employee Check to Login Route**
   - File: `app/api/auth/login/route.ts`
   - After Line 62, add:
   ```typescript
   // Check if user is employee with attendance_only access
   const employee = await queryOne(
     'SELECT access_type FROM employees WHERE id = $1',
     [user.id]
   );
   if (employee && employee.access_type === 'attendance_only') {
     return NextResponse.json(
       { error: 'This account is for attendance only. Please use attendance login.' },
       { status: 403 }
     );
   }
   ```

2. **Add Subscription Limit Checks**
   - Files: Pattern 2 list (13+ endpoints)
   - Add `checkLimit()` after permission check

3. **Add Permission Checks**
   - Files: Pattern 3 list (10+ endpoints)
   - Add `authorize()` before feature check

### Short-Term Actions (HIGH)

4. **Make Role Mandatory**
   - Add NOT NULL constraint to `users.role_id`
   - Add validation in user creation endpoints
   - Migrate existing users without roles

5. **Add Employee Boundary Middleware**
   - Create middleware to reject employee access to portal APIs
   - OR: Add check in each portal API endpoint

### Long-Term Actions (MEDIUM/LOW)

6. **Standardize Enforcement Pattern**
   - Document: Permission → Subscription → Feature
   - Create helper function: `enforceAccess(userId, moduleKey, action, businessId, featureKey)`

7. **Clarify Employee/User Boundary**
   - Consider separate authentication system for employees
   - OR: Add explicit `user_type` field to distinguish

---

## 10. Conclusion

The system has a **solid foundation** with centralized authorization and RBAC/PBAC integration. However, **critical gaps** exist in employee boundary enforcement and inconsistent API enforcement patterns. The most urgent issues are:

1. Login route does not check employee access type
2. APIs missing subscription limit checks
3. APIs missing permission checks
4. Users can exist without roles

**Overall Security Posture:** ⚠️ **MODERATE RISK** - System is functional but has exploitable gaps that should be addressed immediately.

---

**End of Audit Report**
