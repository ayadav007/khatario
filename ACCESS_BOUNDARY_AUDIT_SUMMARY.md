# Access Boundary Audit Summary

**Date:** 2024  
**Scope:** Portal vs Employee Self-Service Access Boundaries

---

## PART 1: SYSTEM AUDIT

### 1.1 Authentication Flows

#### Flow 1: Portal Login
- **Endpoint:** `POST /api/auth/login`
- **Location:** `app/api/auth/login/route.ts:15-138`
- **Method:** Phone + password
- **Current Behavior:**
  - Queries `users` table only
  - **NO CHECK** for employee `access_type`
  - **GAP:** Attendance-only employees can login via portal

#### Flow 2: Attendance/Employee Login
- **Endpoint:** `POST /api/attendance/send-otp` → `POST /api/attendance/verify-otp`
- **Location:** `app/api/attendance/send-otp/route.ts`, `app/api/attendance/verify-otp/route.ts`
- **Method:** Phone + OTP (6-digit, 10-minute expiry)
- **Current Behavior:**
  - ✅ Checks `access_type='attendance_only'` (Line 38 in send-otp)
  - ✅ Rejects `access_type='full'` employees
  - ✅ Creates `attendance_sessions` record

#### Flow 3: Platform Admin Login
- **Endpoint:** `POST /api/admin/auth/login`
- **Separate System:** Uses `platform_admins` table
- **Not Affected:** Separate from business users/employees

### 1.2 Identity Determination

**How System Determines Portal User:**
- User exists in `users` table
- Has `password_hash` (can login)
- **NO CHECK** if user is employee

**How System Determines Employee:**
- User has corresponding record in `employees` table
- `employees.id` = `users.id` (1:1 FK)
- `employees.access_type` = 'full' | 'attendance_only'

**How System Determines Access Type:**
- Query: `SELECT access_type FROM employees WHERE id = $1`
- Values: 'full' (portal access allowed) | 'attendance_only' (portal access denied)

### 1.3 API Categorization

#### Portal APIs (Business Operations)
**Category:** Sales, Purchases, Reports, Settings, Subscriptions
**Examples:**
- `/api/invoices/*` - Invoice management
- `/api/purchases/*` - Purchase management
- `/api/customers/*` - Customer management
- `/api/suppliers/*` - Supplier management
- `/api/items/*` - Item/inventory management
- `/api/reports/*` - Business reports
- `/api/settings/*` - Business settings
- `/api/subscriptions/*` - Subscription management
- `/api/payments/*` - Payment management
- `/api/expenses/*` - Expense management
- `/api/accounts/*` - Chart of accounts
- `/api/journal-entries/*` - Journal entries
- `/api/branches/*` - Branch management
- `/api/warehouses/*` - Warehouse management

**Current Enforcement:**
- ✅ Most check `authorize()` (permission)
- ⚠️ Some check `assertFeatureAccess()` (subscription)
- ❌ **NONE check employee `access_type`**

#### Employee Self-Service APIs
**Category:** Attendance, Leave, Salary, Profile
**Examples:**
- `/api/attendance/*` - Attendance OTP/session
- `/api/employees/attendance/*` - Check-in/check-out
- `/api/employees/leave-requests/*` - Leave applications
- `/api/employees/leave-balances/*` - Leave balances
- `/api/employees/salary/payslips/*` - Salary slips
- `/api/employees/expenses/*` - Employee expense claims
- `/api/employees/[id]` - Employee profile (self-view)

**Current Enforcement:**
- ⚠️ Many use `authorize()` with portal permissions (e.g., 'employees', 'leave_requests')
- ❌ **WRONG:** Employee self-service should NOT require portal permissions
- ✅ Attendance APIs correctly use session tokens

#### Shared APIs (If Any)
**Finding:** No truly shared APIs found. All APIs are either portal or employee-specific.

### 1.4 Enforcement Gaps

#### Gap 1: Portal Login Allows Attendance-Only Employees
- **File:** `app/api/auth/login/route.ts:56-62`
- **Issue:** No check for employee `access_type`
- **Impact:** Attendance-only employee can login via portal if they know password
- **Severity:** CRITICAL

#### Gap 2: Portal APIs Don't Check Employee Access Type
- **Files:** All portal API endpoints
- **Issue:** No early rejection of attendance-only employees
- **Impact:** Attendance-only employee can access portal APIs if they bypass UI
- **Severity:** HIGH

#### Gap 3: Employee APIs Require Portal Permissions
- **Files:** `app/api/employees/leave-requests/route.ts:37`, `app/api/employees/route.ts:43`
- **Issue:** Employee self-service APIs use `authorize()` with portal permissions
- **Impact:** Employee without portal role cannot access own leave/salary data
- **Severity:** HIGH

#### Gap 4: Employee Profile APIs May Require Portal Permissions
- **Files:** `app/api/employees/[id]/route.ts`
- **Issue:** Self-view may require 'employees.read' permission
- **Impact:** Employee cannot view own profile without portal permission
- **Severity:** MEDIUM

---

## PART 2: ACCESS RULES (TO IMPLEMENT)

### RULE A — Attendance-only employees
- `employees.access_type = 'attendance_only'`
- ❌ CANNOT access portal APIs
- ❌ CANNOT access admin APIs
- ❌ CANNOT access subscription/feature APIs
- ✅ CAN access:
  - `/api/attendance/*` (OTP/session)
  - `/api/employees/attendance/*` (check-in/out)
  - `/api/employees/leave-requests/*` (own requests)
  - `/api/employees/leave-balances/*` (own balance)
  - `/api/employees/salary/payslips/*` (own payslips)
  - `/api/employees/[id]` (own profile, if self)

### RULE B — Full-access employees
- `employees.access_type = 'full'`
- ✅ MAY login via portal
- ✅ Portal API access allowed IF:
  - `role_id` exists
  - `authorize()` passes
  - Subscription/feature allows
- ✅ Always allowed employee self-service APIs

### RULE C — Portal users (non-employees)
- Users WITHOUT employee record
- ✅ Normal portal behavior (unchanged)
- ❌ SHOULD NOT access employee-only APIs (optional enforcement)

### RULE D — API-LEVEL ENFORCEMENT
- ✅ Every API must enforce access context
- ❌ UI checks are NOT sufficient

---

## PART 3: IMPLEMENTATION PLAN

### Step 1: Create Access Boundary Helper
- **File:** `lib/access-boundary.ts` (NEW)
- **Function:** `checkEmployeeAccessBoundary(userId, apiContext)`
- **Returns:** `{ allowed: boolean, reason?: string }`
- **Logic:**
  - Query employee record
  - If `access_type='attendance_only'` and `apiContext='portal'` → deny
  - If `access_type='full'` → allow (subject to role/permission)
  - If no employee record → allow (portal user)

### Step 2: Update Portal Login
- **File:** `app/api/auth/login/route.ts`
- **Change:** After password verification, check employee access_type
- **Action:** Reject if `access_type='attendance_only'`

### Step 3: Update Portal APIs
- **Files:** All portal API endpoints
- **Change:** Add early check using helper
- **Action:** Reject attendance-only employees before business logic

### Step 4: Update Employee APIs
- **Files:** Employee self-service APIs
- **Change:** Allow employees without requiring portal permissions
- **Action:** Check if requester is employee (self or manager), bypass portal permission check

### Step 5: Verify Subscription/Feature Alignment
- **Check:** Portal APIs must check subscription
- **Check:** Employee APIs must NOT require subscription features

---

## PART 4: RISK ASSESSMENT

### Breaking Changes Risk: LOW
- ✅ Portal users (non-employees) - NO CHANGE
- ✅ Full-access employees with roles - NO CHANGE
- ✅ Attendance-only employees - CORRECTLY RESTRICTED (was incorrectly allowed)
- ✅ Employee self-service - IMPROVED (was incorrectly restricted)

### Security Improvement: HIGH
- ✅ Prevents attendance-only employees from accessing portal
- ✅ Allows employees to access self-service without portal roles
- ✅ Maintains backward compatibility

---

**End of Audit Summary**
