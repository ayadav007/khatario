# HR & Employees Domain - Complete Security Audit Report

**Date:** $(date)  
**Scope:** RBAC, PBAC, API Routes, UI Pages, Sidebar, Page-Entry Guards  
**Status:** ⚠️ **PARTIALLY PROTECTED** (Critical gaps identified)

---

## 📋 STEP 1 — HR Module Inventory

### Identified HR Modules:
| Module Key | Module Name | Database Status | Notes |
|------------|-------------|-----------------|-------|
| `employees` | Employees | ✅ Exists (migration 059) | Core module |
| `attendance` | Attendance | ✅ Exists (migration 059) | Core module |
| `leave_requests` | Leave Requests | ✅ Exists (migration 127) | Note: Migration 059 has `leaves`, but code uses `leave_requests` |
| `leaves` | Leaves | ✅ Exists (migration 059) | Legacy name, used in PBAC policies |
| `payroll` | Payroll | ✅ Exists (migration 127) | Used for salary payments |
| `commissions` | Commissions | ✅ Exists (migration 059) | Commission management |
| `expenses` | Expenses | ✅ Exists (migration 059) | Employee expenses |
| `hr` | HR / Employees | ✅ Exists (migration 127) | Alias for `employees` |

**Summary:** All HR modules are properly defined in the database.

---

## 📋 STEP 2 — RBAC Data Audit

### Module Existence & Actions

| Module | Exists | Actions | Primary Admin Granted | Notes |
|--------|--------|---------|----------------------|-------|
| `employees` | ✅ | read, create, update, delete | ✅ Yes (API returns all true) | Core module |
| `attendance` | ✅ | read, create, update, delete | ✅ Yes | Core module |
| `leave_requests` | ✅ | read, create, update, delete | ✅ Yes | Migration 127 |
| `leaves` | ✅ | read, create, update, delete | ✅ Yes | Used in PBAC, legacy name |
| `payroll` | ✅ | read, create, update | ✅ Yes | Migration 127 |
| `commissions` | ✅ | read, create, update, delete | ✅ Yes | Core module |
| `expenses` | ✅ | read, create, update, delete | ✅ Yes | Core module |
| `hr` | ✅ | N/A (alias) | ✅ Yes | Alias for employees |

**Primary Admin Handling:**
- ✅ Primary Admin bypass correctly implemented in `/api/settings/permissions`
- ✅ Returns all permissions as `true` for all modules in `permission_modules` table
- ✅ Checks both `is_primary_admin` flag and `role_key = 'primary_admin'`

**Findings:** ✅ RBAC data structure is correct and complete.

---

## 📋 STEP 3 — Backend Route Audit

### HR API Routes Authorization Status

| Route | Method | Resource | Action | Authorization | Status | Notes |
|-------|--------|----------|--------|---------------|--------|-------|
| `/api/employees` | GET | `employees` | `read` | ✅ `authorize()` | ✅ Protected | |
| `/api/employees` | POST | `employees` | `create` | ✅ `authorize()` | ✅ Protected | |
| `/api/employees/[id]` | GET | `employees` | `read` | ✅ `authorize()` | ✅ Protected | |
| `/api/employees/[id]` | PATCH | `employees` | `update` | ✅ `authorize()` | ✅ Protected | |
| `/api/employees/[id]` | DELETE | `employees` | `delete` | ✅ `authorize()` | ✅ Protected | |
| `/api/employees/attendance` | GET | `attendance` | `read` | ✅ `authorize()` | ✅ Protected | |
| `/api/employees/attendance` | POST | `attendance` | `create` | ✅ `authorize()` | ✅ Protected | |
| `/api/employees/attendance/check-in` | POST | `attendance` | `create` | ❓ **UNKNOWN** | ⚠️ **MISSING** | Need to verify |
| `/api/employees/attendance/check-out` | POST | `attendance` | `update` | ❓ **UNKNOWN** | ⚠️ **MISSING** | Need to verify |
| `/api/employees/leave-requests` | GET | `leave_requests` | `read` | ✅ `authorize()` | ✅ Protected | |
| `/api/employees/leave-requests` | POST | `leave_requests` | `create` | ✅ `authorize()` | ✅ Protected | |
| `/api/employees/leave-requests/[id]` | PATCH | `leave_requests` | `update` | ✅ `authorize()` | ✅ Protected | |
| `/api/employees/leave-requests/[id]` | DELETE | `leave_requests` | `delete` | ✅ `authorize()` | ✅ Protected | |
| `/api/employees/salary/payments` | GET | `payroll` | `read` | ✅ `authorize()` | ✅ Protected | |
| `/api/employees/salary/payments` | POST | `payroll` | `create` | ✅ `authorize()` | ✅ Protected | |
| `/api/employees/commissions` | GET | `commissions` | `read` | ❌ **NO AUTHORIZATION** | ❌ **CRITICAL GAP** | **MISSING** |
| `/api/employees/commissions` | POST | `commissions` | `update` | ❌ **NO AUTHORIZATION** | ❌ **CRITICAL GAP** | **MISSING** |
| `/api/employees/expenses` | GET | `expenses` | `read` | ✅ `authorize()` | ✅ Protected | |
| `/api/employees/expenses` | POST | `expenses` | `create` | ✅ `authorize()` | ✅ Protected | |
| `/api/employees/expenses/[id]` | PATCH | `expenses` | `update` | ❓ **UNKNOWN** | ⚠️ **MISSING** | Need to verify |
| `/api/employees/expenses/[id]` | DELETE | `expenses` | `delete` | ❓ **UNKNOWN** | ⚠️ **MISSING** | Need to verify |

**Summary:**
- ✅ **14 routes properly protected** with `authorize()`
- ❌ **2 routes CRITICAL GAP** — `/api/employees/commissions` (GET, POST) **MISSING AUTHORIZATION**
- ⚠️ **4 routes UNVERIFIED** — Check-in/check-out, expenses update/delete

---

## 📋 STEP 4 — PBAC Policy Audit

### HR Policies in `lib/policies/resources/hr.ts`

| Resource | Action | Policy Exists | Requires Permission | Conditions | Status |
|----------|--------|---------------|---------------------|------------|--------|
| `employee` | read | ✅ | `employees.read` | `resourceBelongsToBusiness()` | ✅ |
| `employee` | create | ✅ | `employees.create` | `resourceBelongsToBusiness()` | ✅ |
| `employee` | update | ✅ | `employees.update` | `resourceBelongsToBusiness()` | ✅ |
| `employee` | delete | ✅ | `employees.delete` | `resourceBelongsToBusiness()` | ✅ |
| `employees` | read | ✅ | `employees.read` | `resourceBelongsToBusiness()` | ✅ |
| `employees` | create | ✅ | `employees.create` | `resourceBelongsToBusiness()` | ✅ |
| `employees` | update | ✅ | `employees.update` | `resourceBelongsToBusiness()` | ✅ |
| `employees` | delete | ✅ | `employees.delete` | `resourceBelongsToBusiness()` | ✅ |
| `attendance` | read | ✅ | `attendance.read` | `resourceBelongsToBusiness()` | ✅ |
| `attendance` | create | ✅ | `attendance.create` | `resourceBelongsToBusiness()` | ✅ |
| `attendance` | update | ✅ | `attendance.update` | `resourceBelongsToBusiness()` | ✅ |
| `attendance` | delete | ✅ | `attendance.delete` | `resourceBelongsToBusiness()` | ✅ |
| `payroll` | read | ✅ | `employees.read` | `resourceBelongsToBusiness()` | ⚠️ Uses `employees.read` |
| `payroll` | create | ✅ | `employees.update` | `resourceBelongsToBusiness()` | ⚠️ Uses `employees.update` |
| `payroll` | update | ✅ | `employees.update` | `resourceBelongsToBusiness()` | ⚠️ Uses `employees.update` |
| `salary` | read | ✅ | `employees.read` | `resourceBelongsToBusiness()` | ⚠️ Alias, uses `employees.read` |
| `salary` | create | ✅ | `employees.update` | `resourceBelongsToBusiness()` | ⚠️ Alias, uses `employees.update` |
| `leave_request` | read | ✅ | `leaves.read` | `resourceBelongsToBusiness()` | ⚠️ Uses `leaves.*` (not `leave_requests.*`) |
| `leave_request` | create | ✅ | `leaves.create` | `resourceBelongsToBusiness()` | ⚠️ Uses `leaves.*` (not `leave_requests.*`) |
| `leave_request` | update | ✅ | `leaves.update` | `resourceBelongsToBusiness()` | ⚠️ Uses `leaves.*` (not `leave_requests.*`) |
| `leave_requests` | read | ✅ | `leaves.read` | `resourceBelongsToBusiness()` | ⚠️ Uses `leaves.*` (not `leave_requests.*`) |
| `leave_requests` | create | ✅ | `leaves.create` | `resourceBelongsToBusiness()` | ⚠️ Uses `leaves.*` (not `leave_requests.*`) |
| `leave_requests` | update | ✅ | `leaves.update` | `resourceBelongsToBusiness()` | ⚠️ Uses `leaves.*` (not `leave_requests.*`) |

**Findings:**
- ✅ All core policies exist
- ⚠️ **Permission Key Mismatch:** PBAC policies use `leaves.*` permissions, but API routes use `leave_requests` module
  - This works because both modules exist and Primary Admin has both, but it's inconsistent
- ⚠️ **Payroll uses `employees.*` permissions:** Intentional design choice, but may confuse users
- ❌ **Missing PBAC policies:** No policies for `commissions` resource (CRITICAL GAP)

---

## 📋 STEP 5 — UI Page Entry Audit

### HR UI Pages Authorization Guard Status

| Page | Route | Guard Exists | Resource | Action | Status | Notes |
|------|-------|--------------|----------|--------|--------|-------|
| Employees List | `/employees` | ✅ | `employees` | `read` | ✅ Protected | Uses `useAuthorizationGuard` |
| New Employee | `/employees/new` | ✅ | `employees` | `create` | ✅ Protected | Uses `useAuthorizationGuard` |
| Attendance | `/employees/attendance` | ❌ | N/A | N/A | ❌ **MISSING** | **NO GUARD** |
| Leaves | `/employees/leaves` | ❌ | N/A | N/A | ❌ **MISSING** | **NO GUARD** |
| New Leave | `/employees/leaves/new` | ✅ | `leave_requests` | `create` | ✅ Protected | Uses `useAuthorizationGuard` |
| Salary Payments | `/employees/salary/payments` | ❓ | N/A | N/A | ❓ **UNKNOWN** | Need to verify |
| Commissions | `/employees/commissions` | ❓ | N/A | N/A | ❓ **UNKNOWN** | Need to verify |
| Performance | `/employees/performance` | ❓ | N/A | N/A | ❓ **UNKNOWN** | Need to verify |
| Tasks | `/employees/tasks` | ❓ | N/A | N/A | ❓ **UNKNOWN** | Need to verify |
| Expenses | `/employees/expenses` | ❓ | N/A | N/A | ❓ **UNKNOWN** | Need to verify |

**Findings:**
- ✅ **2 pages properly protected** (Employees list, New Employee, New Leave)
- ❌ **2 pages MISSING guards** (Attendance, Leaves list)
- ❓ **6 pages UNVERIFIED** (Salary, Commissions, Performance, Tasks, Expenses)

---

## 📋 STEP 6 — Sidebar Mapping Audit

### Sidebar HR Item Module Keys

| Sidebar Item | Module Key Used | Correct? | Matches Permission Module? |
|--------------|-----------------|----------|----------------------------|
| All Employees | `employees` | ✅ | ✅ |
| Add Employee | `employees` | ✅ | ✅ |
| Attendance | `attendance` | ✅ | ✅ |
| Leaves | `leave_requests` | ✅ | ✅ |
| Salary Payments | `payroll` | ✅ | ✅ |
| Commissions | `commissions` | ✅ | ✅ |
| Performance | `employees` | ⚠️ | ⚠️ Uses employees module |
| Tasks | `employees` | ⚠️ | ⚠️ Uses employees module |
| Activity Logs | `settings` | ⚠️ | ⚠️ Not HR-related |

**Findings:**
- ✅ **Core HR items correctly mapped**
- ⚠️ **Performance and Tasks use `employees` module** — This is acceptable if intentional
- ⚠️ **Activity Logs uses `settings`** — May be intentional, but not HR-specific

---

## 📋 STEP 7 — End-to-End Verification

### Simulated User Scenarios

**Primary Admin:**
- ✅ Sidebar: All HR modules visible (via permissions API bypass)
- ✅ Page Access: All pages accessible (backend PBAC allows)
- ⚠️ API Access: `/api/employees/commissions` unprotected (no authorization check)

**HR Manager (with HR permissions):**
- ✅ Sidebar: HR modules visible (via `canView()`)
- ⚠️ Page Access: Attendance and Leaves pages have no guards (users can access even without permissions)
- ❌ API Access: `/api/employees/commissions` unprotected (critical security gap)

**Non-HR User (no HR permissions):**
- ✅ Sidebar: HR modules hidden (via `canView()`)
- ❌ Page Access: Can still access `/employees/attendance` and `/employees/leaves` directly (no guards)
- ❌ API Access: Can access `/api/employees/commissions` without authorization

---

## 🚨 CRITICAL GAPS IDENTIFIED

### Gap 1: Missing Authorization on Commissions API
- **Location:** `app/api/employees/commissions/route.ts`
- **Type:** Backend RBAC/PBAC
- **Severity:** ❌ **CRITICAL**
- **Details:**
  - GET `/api/employees/commissions` — NO `authorize()` call
  - POST `/api/employees/commissions` — NO `authorize()` call
  - No `user_id` parameter validation
  - Anyone with `business_id` can access commission data
- **Impact:** Unauthorized users can view and modify commission data

### Gap 2: Missing PBAC Policies for Commissions
- **Location:** `lib/policies/resources/hr.ts`
- **Type:** PBAC Policy Definition
- **Severity:** ❌ **CRITICAL**
- **Details:**
  - No policies defined for `commissions` resource
  - Even if authorization is added, PBAC will fail
- **Impact:** Cannot enforce commission access control

### Gap 3: Missing Page-Entry Guards
- **Location:** 
  - `app/employees/attendance/page.tsx`
  - `app/employees/leaves/page.tsx`
- **Type:** UI Authorization Guard
- **Severity:** ⚠️ **MEDIUM**
- **Details:**
  - No `useAuthorizationGuard()` calls
  - Users can navigate directly to pages even without permissions
  - API calls will still fail, but UX is broken
- **Impact:** Poor UX, users see errors instead of being blocked

### Gap 4: Unverified Routes
- **Location:** Multiple routes (check-in, check-out, expenses update/delete)
- **Type:** Backend Authorization
- **Severity:** ⚠️ **MEDIUM**
- **Details:**
  - Need to verify if these routes have authorization
- **Impact:** Unknown security posture

---

## ✅ FIX RECOMMENDATIONS

### Priority 1: CRITICAL (Security)

#### Fix 1.1: Add Authorization to Commissions API
**File:** `app/api/employees/commissions/route.ts`

```typescript
// GET route
const userId = searchParams.get('user_id');
if (!userId) {
  return NextResponse.json(
    { error: 'user_id is required for authorization' },
    { status: 400 }
  );
}
try {
  await authorize(userId, 'commissions', 'read', { businessId });
} catch (error) {
  if (error instanceof AuthorizationError) {
    return NextResponse.json(error.toResponse(), { status: error.statusCode });
  }
  throw error;
}

// POST route
const { updated_by_user_id } = body;
if (!updated_by_user_id) {
  return NextResponse.json(
    { error: 'updated_by_user_id is required for authorization' },
    { status: 400 }
  );
}
try {
  await authorize(updated_by_user_id, 'commissions', 'update', { businessId });
} catch (error) {
  // ... error handling
}
```

#### Fix 1.2: Add PBAC Policies for Commissions
**File:** `lib/policies/resources/hr.ts`

```typescript
// Add to getHrPolicies() array
{
  resource: 'commissions',
  action: 'read',
  requiresPermission: 'commissions.read',
  priority: 10,
  conditions: [resourceBelongsToBusiness()],
},
{
  resource: 'commissions',
  action: 'update',
  requiresPermission: 'commissions.update',
  priority: 10,
  conditions: [resourceBelongsToBusiness()],
},
```

### Priority 2: MEDIUM (UX & Consistency)

#### Fix 2.1: Add Page-Entry Guards
**Files:**
- `app/employees/attendance/page.tsx`
- `app/employees/leaves/page.tsx`

```typescript
import { useAuthorizationGuard } from '@/hooks/useAuthorizationGuard';
import { AccessDenied } from '@/components/common/AccessDenied';

// In component:
const { allowed: canRead, loading: authLoading } = useAuthorizationGuard({
  resource: 'attendance', // or 'leave_requests'
  action: 'read',
  skipCheck: !user?.id || !business?.id,
});

if (authLoading) {
  return <AppLayout><Loader2 /></AppLayout>;
}
if (!canRead) {
  return <AppLayout><AccessDenied module="attendance" action="read" /></AppLayout>;
}
```

#### Fix 2.2: Verify Unverified Routes
- Review `app/api/employees/attendance/check-in/route.ts`
- Review `app/api/employees/attendance/check-out/route.ts`
- Review `app/api/employees/expenses/[id]/route.ts` (PATCH, DELETE)
- Ensure all have `authorize()` calls with correct resource/action

---

## 📊 FINAL VERDICT

### ⚠️ HR is PARTIALLY PROTECTED

**Strengths:**
- ✅ Core RBAC structure is solid
- ✅ Most API routes properly protected
- ✅ PBAC policies exist for core resources
- ✅ Sidebar filtering works correctly
- ✅ Primary Admin bypass implemented correctly

**Critical Gaps:**
- ❌ **Commissions API unprotected** (CRITICAL)
- ❌ **Missing PBAC policies for commissions** (CRITICAL)
- ⚠️ **Missing page-entry guards** (MEDIUM)
- ⚠️ **Unverified routes** (MEDIUM)

**Recommendation:**
1. **IMMEDIATE:** Fix commissions API authorization (Priority 1.1 & 1.2)
2. **SHORT-TERM:** Add missing page-entry guards (Priority 2.1)
3. **SHORT-TERM:** Verify and fix unverified routes (Priority 2.2)

---

## 📝 NOTES

1. **Permission Key Inconsistency:** PBAC uses `leaves.*` but API uses `leave_requests`. This works but is confusing. Consider standardizing.
2. **Payroll Permissions:** Payroll uses `employees.*` permissions. This is acceptable if intentional, but document the design decision.
3. **Activity Logs:** Uses `settings` module in sidebar, not HR-specific. Verify if this is intentional.

---

**Report Generated:** $(date)  
**Auditor:** Cursor AI  
**Review Status:** Requires immediate action on critical gaps
