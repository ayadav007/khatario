# 🎯 Limits Registry System Implementation

## ✅ **COMPLETED IMPLEMENTATION**

A complete Limits Registry system has been implemented to make subscription limits data-driven and admin-controllable, including HR & Employee limits.

---

## 📊 **DATABASE MIGRATION**

### Created Tables

1. **`platform_limits`** - Central registry of all limit types
   - Limits organized by category (sales, purchase, hr, general, integrations)
   - Includes labels, descriptions, units, default values
   - Supports unlimited (-1) values

2. **`subscription_plan_limits`** - Plan → Limit mapping
   - Many-to-many relationship
   - Stores limit values per plan
   - Migrated existing JSONB limits

### Migration File
- `database/migrations/013_limits_registry_system.sql`
- Run this migration to set up the Limits Registry
- Includes data migration from JSONB to relational tables

---

## 🔧 **BACKEND UPDATES**

### Updated `lib/subscription.ts`

**Key Changes:**
- `checkLimit()` now checks Limits Registry FIRST
- Falls back to JSONB if registry data is missing (backward compatibility)
- Supports new HR limit types (employees, attendance, leave_requests, payroll, etc.)
- Added `getLimitFromRegistry()` helper function

**New Limit Types Supported:**
- `employees` - Max employees
- `attendance` - Max attendance records per month
- `leave_requests` - Max leave requests per month
- `payroll` - Max payroll records per month
- `suppliers` - Max suppliers
- `purchases` - Max purchases per month
- `expenses` - Max expenses per month

---

## 🌐 **API ENDPOINTS**

### New Endpoints

1. **`GET /api/admin/limits`**
   - Returns all platform limits grouped by category
   - Used by admin UI

2. **`GET /api/admin/plans/[planId]/limits`**
   - Returns limits for a specific plan with current values
   - Used by admin limits matrix

3. **`POST /api/admin/plans/[planId]/limits`**
   - Updates limit values for a plan
   - Clears subscription cache on update

---

## 🎨 **ADMIN UI**

### New Component: `PlanLimitsMatrix`

- Beautiful limits matrix UI grouped by category
- Number inputs for each limit
- Visual indicators (Unlimited, Disabled)
- Shows current values and units
- Save changes with cache clearing

### Updated Admin Plans Page

- Added "Limits" button per plan (green button)
- Opens Limits Matrix modal
- Limit values persist to database

---

## 📋 **LIMITS BY CATEGORY**

### **Sales Limits:**
- `max_invoices_per_month`
- `max_customers`
- `max_items`
- `max_estimates_per_month`
- `max_credit_notes_per_month`
- `max_sales_orders_per_month`

### **Purchase Limits:**
- `max_purchases_per_month`
- `max_suppliers`
- `max_purchase_orders_per_month`
- `max_expenses_per_month`

### **HR & Employees Limits:**
- `max_employees` - Total employees
- `max_attendance_records_per_month` - Attendance entries
- `max_leave_requests_per_month` - Leave requests (all employees)
- `max_leave_requests_per_employee_per_year` - Per employee annual limit
- `max_payroll_records_per_month` - Payslips/payroll records
- `max_salary_advances_per_month` - Salary advances
- `max_designations` - Job titles/designations
- `max_shifts` - Shift definitions
- `max_holidays` - Holiday/leave type configurations
- `max_performance_reviews_per_month` - Performance reviews
- `max_employee_expenses_per_month` - Employee expense claims
- `max_commissions_per_month` - Commission records
- `max_employee_tasks_per_month` - Task assignments

### **General Limits:**
- `max_users`
- `max_branches`
- `max_departments`

### **Integrations Limits:**
- `max_whatsapp_per_day`
- `max_email_per_day`

---

## 🚀 **HOW TO USE**

### 1. Run Database Migration

```sql
-- Connect to your database
psql -U your_user -d your_database

-- Run migration
\i database/migrations/013_limits_registry_system.sql
```

### 2. Verify Migration

```sql
-- Check limits were created
SELECT COUNT(*) FROM platform_limits;

-- Check plan limits were migrated
SELECT plan_id, COUNT(*) FROM subscription_plan_limits GROUP BY plan_id;
```

### 3. Use Admin UI

1. Navigate to `/admin/plans`
2. Click "Limits" button on any plan
3. Set limit values (-1 for unlimited, 0 for disabled)
4. Click "Save Changes"

### 4. Limits Automatically Apply

- Backend enforcement uses Limits Registry
- Falls back to JSONB if registry is empty
- Cache cleared on updates

---

## 🔄 **BACKWARD COMPATIBILITY**

✅ **Full backward compatibility maintained:**
- JSONB limits still work if registry is empty
- Legacy limit types mapped automatically
- Gradual migration path available
- No breaking changes

---

## 📝 **USAGE IN CODE**

### Check Limits in API Routes

```typescript
import { checkLimit } from '@/lib/subscription';

// Check invoice limit
const limitCheck = await checkLimit(business_id, 'invoices');
if (!limitCheck.allowed) {
  return NextResponse.json(
    { error: limitCheck.message, code: 'SUBSCRIPTION_LIMIT_EXCEEDED' },
    { status: 403 }
  );
}

// Check HR limits
const employeeLimit = await checkLimit(business_id, 'employees');
const attendanceLimit = await checkLimit(business_id, 'attendance');
const leaveLimit = await checkLimit(business_id, 'leave_requests');
```

---

## 🎉 **BENEFITS**

- ✅ **Data-Driven**: Limits controlled via database, not code
- ✅ **Admin-Controlled**: Platform owners can manage limits without code changes
- ✅ **HR-Ready**: All HR limits included and ready to use
- ✅ **Future-Proof**: Easy to add new limit types
- ✅ **Backward Compatible**: Existing system continues to work
- ✅ **Scalable**: Supports unlimited limit types

---

**Implementation Complete! 🎊**
