# Employee Portal Access Policy

**Version:** 1.0  
**Last Updated:** 2024  
**Status:** Enforced

---

## Overview

This document defines the access boundaries between **Portal Features** (business operations) and **Employee Self-Service Features** (attendance, leave, salary, profile).

**Key Principle:** Employees and users share the same authentication identity. Access is determined by `access_type` + `role` + `permission` + `API context`.

---

## Access Types

### 1. Attendance-Only Employees
**Definition:** `employees.access_type = 'attendance_only'`

**Access Rules:**
- ❌ **CANNOT** access portal APIs (sales, purchases, reports, settings, subscriptions)
- ❌ **CANNOT** access admin APIs
- ❌ **CANNOT** login via portal login (`/api/auth/login`)
- ✅ **CAN** access:
  - Attendance APIs (`/api/attendance/*`, `/api/employees/attendance/*`)
  - Leave APIs (`/api/employees/leave-requests/*`, `/api/employees/leave-balances/*`)
  - Salary slip APIs (`/api/employees/salary/payslips/*`)
  - Employee profile API (`/api/employees/[id]` - own profile only)
  - Employee expense claims (`/api/employees/expenses/*` - own expenses only)

**Authentication:**
- Must use attendance login (`/api/attendance/send-otp` → `/api/attendance/verify-otp`)
- Receives `attendance_session_token` (1-hour expiry)
- Cannot use portal login (phone + password)

**Example Use Cases:**
- Factory workers marking attendance
- Field staff checking in/out
- Contract workers viewing salary slips

---

### 2. Full-Access Employees
**Definition:** `employees.access_type = 'full'`

**Access Rules:**
- ✅ **CAN** login via portal login (`/api/auth/login`)
- ✅ **CAN** access portal APIs **IF**:
  - `role_id` exists
  - `authorize()` passes (has permission)
  - Subscription/feature allows access
- ✅ **ALWAYS** allowed employee self-service APIs (regardless of portal permissions)

**Authentication:**
- Can use portal login (phone + password)
- Can use attendance login (OTP) - but will be redirected to use portal login

**Example Use Cases:**
- Manager who is also an employee
- Accountant who needs both portal and self-service access
- Salesperson who tracks attendance and manages customers

---

### 3. Portal Users (Non-Employees)
**Definition:** Users WITHOUT employee record

**Access Rules:**
- ✅ Normal portal behavior (unchanged)
- ✅ Access portal APIs based on role/permission/subscription
- ❌ **SHOULD NOT** access employee-only APIs (optional enforcement)

**Authentication:**
- Portal login only (`/api/auth/login`)

**Example Use Cases:**
- Business owner (primary admin)
- External accountant
- Sales team member (not employee)

---

## API Categorization

### Portal APIs (Business Operations)

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
- `/api/expenses/*` - Business expense tracking
- `/api/accounts/*` - Chart of accounts
- `/api/journal-entries/*` - Journal entries
- `/api/branches/*` - Branch management
- `/api/warehouses/*` - Warehouse management

**Enforcement:**
1. ✅ Check access boundary (reject attendance-only employees)
2. ✅ Check permission (`authorize()`)
3. ✅ Check subscription/feature access

---

### Employee Self-Service APIs

**Category:** Attendance, Leave, Salary, Profile

**Examples:**
- `/api/attendance/*` - Attendance OTP/session
- `/api/employees/attendance/*` - Check-in/check-out
- `/api/employees/leave-requests/*` - Leave applications
- `/api/employees/leave-balances/*` - Leave balances
- `/api/employees/salary/payslips/*` - Salary slips
- `/api/employees/expenses/*` - Employee expense claims
- `/api/employees/[id]` - Employee profile

**Enforcement:**
1. ✅ Allow if user is employee accessing own resource (self-service)
2. ✅ OR require portal permission if accessing other employee's resource
3. ❌ **DO NOT** require subscription features for self-service

---

## Real-World Examples

### Example 1: Factory Worker (Attendance-Only)
**Scenario:** Worker needs to mark attendance and view salary slip

**Access:**
- ✅ Can mark attendance via OTP login
- ✅ Can view own salary slip
- ✅ Can apply for leave
- ❌ Cannot access invoices, customers, reports
- ❌ Cannot login via portal

**Implementation:**
```typescript
// Employee record
{
  id: "user-123",
  access_type: "attendance_only",
  employee_code: "EMP001"
}

// Portal login attempt → REJECTED (403)
// Attendance login → ALLOWED
// GET /api/employees/salary/payslips/[id] → ALLOWED (self)
// GET /api/invoices → REJECTED (403)
```

---

### Example 2: Manager (Full-Access Employee)
**Scenario:** Manager who is also an employee, needs portal access and self-service

**Access:**
- ✅ Can login via portal (has `role_id` with permissions)
- ✅ Can access invoices, reports, settings (if permission allows)
- ✅ Can mark own attendance
- ✅ Can view own leave balance
- ✅ Can view own salary slip

**Implementation:**
```typescript
// Employee record
{
  id: "user-456",
  access_type: "full",
  employee_code: "EMP002"
}

// User record
{
  id: "user-456",
  role_id: "role-manager-123",
  // Has 'invoices.read', 'reports.read' permissions
}

// Portal login → ALLOWED
// GET /api/invoices → ALLOWED (has permission)
// GET /api/employees/leave-balances?employee_id=user-456 → ALLOWED (self)
// GET /api/employees/attendance/check-in → ALLOWED (self)
```

---

### Example 3: Accountant (Portal User, Not Employee)
**Scenario:** External accountant managing business finances

**Access:**
- ✅ Can login via portal
- ✅ Can access invoices, reports, accounts (if permission allows)
- ❌ Cannot mark attendance (not an employee)
- ❌ Cannot view salary slips (not an employee)

**Implementation:**
```typescript
// User record (NO employee record)
{
  id: "user-789",
  role_id: "role-accountant-456",
  // Has 'invoices.read', 'reports.read', 'accounts.read' permissions
}

// Portal login → ALLOWED
// GET /api/invoices → ALLOWED (has permission)
// GET /api/employees/attendance/check-in → REJECTED (not employee)
```

---

## Enforcement Points

### 1. Portal Login
**File:** `app/api/auth/login/route.ts`

**Check:**
- After password verification, query employee record
- If `access_type = 'attendance_only'` → Reject with 403

**Code:**
```typescript
const employee = await queryOne(
  `SELECT access_type FROM employees WHERE id = $1 AND is_active = true`,
  [user.id]
);

if (employee && employee.access_type === 'attendance_only') {
  return NextResponse.json(
    { error: 'This account is for attendance only. Please use the attendance login page.' },
    { status: 403 }
  );
}
```

---

### 2. Portal APIs
**Files:** All portal API endpoints

**Check:**
- Early rejection using `checkEmployeeAccessBoundary(userId, 'portal')`
- Before permission/subscription checks

**Code:**
```typescript
const { checkEmployeeAccessBoundary } = await import('@/lib/access-boundary');
const accessCheck = await checkEmployeeAccessBoundary(created_by, 'portal');
if (!accessCheck.allowed) {
  return NextResponse.json(
    { error: accessCheck.reason, code: 'ACCESS_DENIED' },
    { status: 403 }
  );
}
```

---

### 3. Employee Self-Service APIs
**Files:** Employee API endpoints

**Check:**
- Allow if user is employee accessing own resource
- OR require portal permission if accessing other employee's resource
- DO NOT require subscription features for self-service

**Code:**
```typescript
const { isEmployee } = await import('@/lib/access-boundary');
const userIsEmployee = await isEmployee(userId);

if (userIsEmployee && userId === employeeId) {
  // Self-service access allowed - no portal permission needed
} else {
  // Portal user or accessing other employee - require permission
  await authorize(userId, 'employees', 'read', { businessId });
}
```

---

## Access Boundary Helper

**File:** `lib/access-boundary.ts`

**Functions:**
- `checkEmployeeAccessBoundary(userId, apiContext)` - Check if user can access API
- `isEmployee(userId)` - Check if user is an employee
- `canAccessEmployeeResource(userId, employeeId, hasPermission)` - Check employee resource access

**Usage:**
```typescript
import { checkEmployeeAccessBoundary } from '@/lib/access-boundary';

// Portal API
const check = await checkEmployeeAccessBoundary(userId, 'portal');
if (!check.allowed) {
  return NextResponse.json({ error: check.reason }, { status: 403 });
}

// Employee API
const isEmp = await isEmployee(userId);
if (isEmp && userId === employeeId) {
  // Self-service allowed
}
```

---

## Security Guarantees

### ✅ Guaranteed
1. Attendance-only employees **CANNOT** access portal APIs (enforced at API level)
2. Attendance-only employees **CANNOT** login via portal (enforced at login)
3. Employees can access self-service APIs without portal permissions (self-access)
4. Portal users experience **NO behavior change** (backward compatible)

### ⚠️ Not Enforced (By Design)
1. Portal users accessing employee APIs - Optional enforcement (not required)
2. Full-access employees without `role_id` - Will fail permission checks (expected)

---

## Migration Notes

### Existing Employees
- **No changes required** - Existing employees continue to work
- Attendance-only employees are now correctly restricted (was incorrectly allowed before)
- Full-access employees with roles continue to work as before

### Existing Portal Users
- **No changes** - Portal users (non-employees) experience no behavior change

### Breaking Changes
- **NONE** - All changes are security improvements, not breaking changes

---

## Troubleshooting

### Issue: "This account is for attendance only"
**Cause:** Employee with `access_type='attendance_only'` trying to login via portal

**Solution:** Use attendance login (`/attendance/login`) instead of portal login

---

### Issue: Employee cannot access own leave balance
**Cause:** API not updated to allow self-service

**Solution:** Update API to check if user is employee accessing own resource

---

### Issue: Full-access employee cannot access portal
**Cause:** Employee has `access_type='full'` but no `role_id`

**Solution:** Assign `role_id` to employee or update `access_type` to 'attendance_only'

---

**End of Policy Document**
