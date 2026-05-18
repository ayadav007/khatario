# Missing user_id/created_by/updated_by Audit Report

Generated: 2026-01-16T06:04:44.942Z

Total APIs requiring user_id: 156
Total frontend API calls found: 532
Missing user_id cases: 41

---

## 🔴 HIGH PRIORITY - Missing user_id (Breaking Issues)

### /accounts

**API Endpoint:** `GET /accounts`
**Expected Field:** user_id (query param)
**API File:** `app\api\accounts\route.ts`
**Frontend File:** `app\accounts\page.tsx` (Line 62)
**Frontend Method:** GET
**Current Status:** ❌ Missing user_id (query param)

**Fix Required:**
Add `user_id` parameter (as query param).

### /credit-notes

**API Endpoint:** `GET /credit-notes`
**Expected Field:** user_id (query param)
**API File:** `app\api\credit-notes\route.ts`
**Frontend File:** `app\credit-notes\page.tsx` (Line 56)
**Frontend Method:** GET
**Current Status:** ❌ Missing user_id (query param)

**Fix Required:**
Add `user_id` parameter (as query param).

**API Endpoint:** `POST /credit-notes`
**Expected Field:** created_by (body)
**API File:** `app\api\credit-notes\route.ts`
**Frontend File:** `app\credit-notes\new\page.tsx` (Line 321)
**Frontend Method:** POST
**Current Status:** ❌ Missing created_by (body)

**Current Body:**
```typescript
payload
```

**Fix Required:**
Add `created_by: user?.id` to the request body.

### /customers

**API Endpoint:** `GET /customers`
**Expected Field:** user_id (query param)
**API File:** `app\api\customers\route.ts`
**Frontend File:** `app\customers\page.tsx` (Line 43)
**Frontend Method:** GET
**Current Status:** ❌ Missing user_id (query param)

**Fix Required:**
Add `user_id` parameter (as query param).

### /debit-notes

**API Endpoint:** `POST /debit-notes`
**Expected Field:** created_by (body)
**API File:** `app\api\debit-notes\route.ts`
**Frontend File:** `app\debit-notes\new\page.tsx` (Line 113)
**Frontend Method:** POST
**Current Status:** ❌ Missing created_by (body)

**Current Body:**
```typescript
payload
```

**Fix Required:**
Add `created_by: user?.id` to the request body.

### /employees/attendance

**API Endpoint:** `GET /employees/attendance`
**Expected Field:** user_id (query param)
**API File:** `app\api\employees\attendance\route.ts`
**Frontend File:** `app\attendance\kiosk\page.tsx` (Line 99)
**Frontend Method:** GET
**Current Status:** ❌ Missing user_id (query param)

**Fix Required:**
Add `user_id` parameter (as query param).

**API Endpoint:** `GET /employees/attendance`
**Expected Field:** user_id (query param)
**API File:** `app\api\employees\attendance\route.ts`
**Frontend File:** `app\employees\attendance\page.tsx` (Line 49)
**Frontend Method:** GET
**Current Status:** ❌ Missing user_id (query param)

**Fix Required:**
Add `user_id` parameter (as query param).

**API Endpoint:** `POST /employees/attendance`
**Expected Field:** created_by (body)
**API File:** `app\api\employees\attendance\route.ts`
**Frontend File:** `app\employees\attendance\mark\page.tsx` (Line 90)
**Frontend Method:** POST
**Current Status:** ❌ Missing created_by (body)

**Current Body:**
```typescript
{
          business_id: business.id,
          ...formData,
          shift_id: formData.shift_id || null,
          check_in_time: formData.check_in_time ? `${formData.date}T${formData.check_in_
```

**Fix Required:**
Add `created_by: user?.id` to the request body.

### /employees/expenses

**API Endpoint:** `GET /employees/expenses`
**Expected Field:** user_id (query param)
**API File:** `app\api\employees\expenses\route.ts`
**Frontend File:** `app\employees\expenses\page.tsx` (Line 97)
**Frontend Method:** GET
**Current Status:** ❌ Missing user_id (query param)

**Fix Required:**
Add `user_id` parameter (as query param).

**API Endpoint:** `POST /employees/expenses`
**Expected Field:** created_by (body)
**API File:** `app\api\employees\expenses\route.ts`
**Frontend File:** `app\employees\expenses\new\page.tsx` (Line 130)
**Frontend Method:** POST
**Current Status:** ❌ Missing created_by (body)

**Current Body:**
```typescript
{
          business_id: business.id,
          ...formData,
          amount: parseFloat(formData.amount
```

**Fix Required:**
Add `created_by: user?.id` to the request body.

### /employees/leave-requests

**API Endpoint:** `GET /employees/leave-requests`
**Expected Field:** user_id (query param)
**API File:** `app\api\employees\leave-requests\route.ts`
**Frontend File:** `app\employees\leaves\page.tsx` (Line 51)
**Frontend Method:** GET
**Current Status:** ❌ Missing user_id (query param)

**Fix Required:**
Add `user_id` parameter (as query param).

### /employees

**API Endpoint:** `GET /employees`
**Expected Field:** user_id (query param)
**API File:** `app\api\employees\route.ts`
**Frontend File:** `app\employees\page.tsx` (Line 54)
**Frontend Method:** GET
**Current Status:** ❌ Missing user_id (query param)

**Fix Required:**
Add `user_id` parameter (as query param).

**API Endpoint:** `GET /employees`
**Expected Field:** user_id (query param)
**API File:** `app\api\employees\route.ts`
**Frontend File:** `app\settings\commission-rules\page.tsx` (Line 87)
**Frontend Method:** GET
**Current Status:** ❌ Missing user_id (query param)

**Fix Required:**
Add `user_id` parameter (as query param).

**API Endpoint:** `POST /employees`
**Expected Field:** created_by (body)
**API File:** `app\api\employees\route.ts`
**Frontend File:** `app\employees\new\page.tsx` (Line 203)
**Frontend Method:** POST
**Current Status:** ❌ Missing created_by (body)

**Current Body:**
```typescript
payload
```

**Fix Required:**
Add `created_by: user?.id` to the request body.

### /employees/salary/advances

**API Endpoint:** `GET /employees/salary/advances`
**Expected Field:** user_id (query param)
**API File:** `app\api\employees\salary\advances\route.ts`
**Frontend File:** `app\employees\salary\advances\page.tsx` (Line 43)
**Frontend Method:** GET
**Current Status:** ❌ Missing user_id (query param)

**Fix Required:**
Add `user_id` parameter (as query param).

**API Endpoint:** `POST /employees/salary/advances`
**Expected Field:** user_id (body)
**API File:** `app\api\employees\salary\advances\route.ts`
**Frontend File:** `app\employees\salary\advances\new\page.tsx` (Line 65)
**Frontend Method:** POST
**Current Status:** ❌ Missing user_id (body)

**Current Body:**
```typescript
{
          business_id: business.id,
          ...formData,
          recovery_months: formData.recovery_method === 'salary_deduction' && formData.recovery_months
            ? parseInt(formData.
```

**Fix Required:**
Add `user_id` parameter (to body).

### /employees/salary/payments

**API Endpoint:** `GET /employees/salary/payments`
**Expected Field:** user_id (query param)
**API File:** `app\api\employees\salary\payments\route.ts`
**Frontend File:** `app\employees\salary\payments\page.tsx` (Line 43)
**Frontend Method:** GET
**Current Status:** ❌ Missing user_id (query param)

**Fix Required:**
Add `user_id` parameter (as query param).

### /inventory-adjustments

**API Endpoint:** `GET /inventory-adjustments`
**Expected Field:** user_id (query param)
**API File:** `app\api\inventory-adjustments\route.ts`
**Frontend File:** `app\inventory-adjustments\page.tsx` (Line 85)
**Frontend Method:** GET
**Current Status:** ❌ Missing user_id (query param)

**Fix Required:**
Add `user_id` parameter (as query param).

**API Endpoint:** `POST /inventory-adjustments`
**Expected Field:** created_by (body)
**API File:** `app\api\inventory-adjustments\route.ts`
**Frontend File:** `app\inventory-adjustments\new\page.tsx` (Line 285)
**Frontend Method:** POST
**Current Status:** ❌ Missing created_by (body)

**Current Body:**
```typescript
payload
```

**Fix Required:**
Add `created_by: user?.id` to the request body.

### /invoices/for-reminders

**API Endpoint:** `GET /invoices/for-reminders`
**Expected Field:** user_id (query param)
**API File:** `app\api\invoices\for-reminders\route.ts`
**Frontend File:** `components\whatsapp\SendRemindersTab.tsx` (Line 66)
**Frontend Method:** GET
**Current Status:** ❌ Missing user_id (query param)

**Fix Required:**
Add `user_id` parameter (as query param).

### /invoices

**API Endpoint:** `POST /invoices`
**Expected Field:** created_by (body)
**API File:** `app\api\invoices\route.ts`
**Frontend File:** `app\invoices\new\page.tsx` (Line 1973)
**Frontend Method:** POST
**Current Status:** ❌ Missing created_by (body)

**Current Body:**
```typescript
{ ...payload, invoice_number: invoiceNumber }
```

**Fix Required:**
Add `created_by: user?.id` to the request body.

### /items

**API Endpoint:** `GET /items`
**Expected Field:** user_id (query param)
**API File:** `app\api\items\route.ts`
**Frontend File:** `app\items\page.tsx` (Line 45)
**Frontend Method:** GET
**Current Status:** ❌ Missing user_id (query param)

**Fix Required:**
Add `user_id` parameter (as query param).

**API Endpoint:** `GET /items`
**Expected Field:** user_id (query param)
**API File:** `app\api\items\route.ts`
**Frontend File:** `app\purchases\requests\page.tsx` (Line 158)
**Frontend Method:** GET
**Current Status:** ❌ Missing user_id (query param)

**Fix Required:**
Add `user_id` parameter (as query param).

**API Endpoint:** `POST /items`
**Expected Field:** created_by (body)
**API File:** `app\api\items\route.ts`
**Frontend File:** `app\items\new\page.tsx` (Line 617)
**Frontend Method:** POST
**Current Status:** ❌ Missing created_by (body)

**Current Body:**
```typescript
payload
```

**Fix Required:**
Add `created_by: user?.id` to the request body.

### /journal-entries

**API Endpoint:** `GET /journal-entries`
**Expected Field:** user_id (query param)
**API File:** `app\api\journal-entries\route.ts`
**Frontend File:** `app\journal-entries\page.tsx` (Line 71)
**Frontend Method:** GET
**Current Status:** ❌ Missing user_id (query param)

**Fix Required:**
Add `user_id` parameter (as query param).

### /purchases

**API Endpoint:** `GET /purchases`
**Expected Field:** user_id (query param)
**API File:** `app\api\purchases\route.ts`
**Frontend File:** `app\purchases\page.tsx` (Line 96)
**Frontend Method:** GET
**Current Status:** ❌ Missing user_id (query param)

**Fix Required:**
Add `user_id` parameter (as query param).

**API Endpoint:** `POST /purchases`
**Expected Field:** created_by (body)
**API File:** `app\api\purchases\route.ts`
**Frontend File:** `app\purchases\new\page.tsx` (Line 373)
**Frontend Method:** POST
**Current Status:** ❌ Missing created_by (body)

**Current Body:**
```typescript
payload
```

**Fix Required:**
Add `created_by: user?.id` to the request body.

### /reports/aging/payables

**API Endpoint:** `GET /reports/aging/payables`
**Expected Field:** user_id (query param)
**API File:** `app\api\reports\aging\payables\route.ts`
**Frontend File:** `app\reports\aging\payables\page.tsx` (Line 45)
**Frontend Method:** GET
**Current Status:** ❌ Missing user_id (query param)

**Fix Required:**
Add `user_id` parameter (as query param).

### /reports/aging/receivables

**API Endpoint:** `GET /reports/aging/receivables`
**Expected Field:** user_id (query param)
**API File:** `app\api\reports\aging\receivables\route.ts`
**Frontend File:** `app\reports\aging\receivables\page.tsx` (Line 45)
**Frontend Method:** GET
**Current Status:** ❌ Missing user_id (query param)

**Fix Required:**
Add `user_id` parameter (as query param).

### /reports/balance-sheet

**API Endpoint:** `GET /reports/balance-sheet`
**Expected Field:** user_id (query param)
**API File:** `app\api\reports\balance-sheet\route.ts`
**Frontend File:** `app\reports\balance-sheet\page.tsx` (Line 143)
**Frontend Method:** GET
**Current Status:** ❌ Missing user_id (query param)

**Fix Required:**
Add `user_id` parameter (as query param).

### /reports/cash-flow

**API Endpoint:** `GET /reports/cash-flow`
**Expected Field:** user_id (query param)
**API File:** `app\api\reports\cash-flow\route.ts`
**Frontend File:** `app\reports\cash-flow\page.tsx` (Line 99)
**Frontend Method:** GET
**Current Status:** ❌ Missing user_id (query param)

**Fix Required:**
Add `user_id` parameter (as query param).

### /reports/gst/gstr1

**API Endpoint:** `GET /reports/gst/gstr1`
**Expected Field:** user_id (query param)
**API File:** `app\api\reports\gst\gstr1\route.ts`
**Frontend File:** `app\reports\gst\gstr1\page.tsx` (Line 77)
**Frontend Method:** GET
**Current Status:** ❌ Missing user_id (query param)

**Fix Required:**
Add `user_id` parameter (as query param).

### /reports/gst/gstr2b

**API Endpoint:** `GET /reports/gst/gstr2b`
**Expected Field:** user_id (query param)
**API File:** `app\api\reports\gst\gstr2b\route.ts`
**Frontend File:** `app\reports\gst\gstr2b\page.tsx` (Line 52)
**Frontend Method:** GET
**Current Status:** ❌ Missing user_id (query param)

**Fix Required:**
Add `user_id` parameter (as query param).

### /reports/gst/gstr3b

**API Endpoint:** `GET /reports/gst/gstr3b`
**Expected Field:** user_id (query param)
**API File:** `app\api\reports\gst\gstr3b\route.ts`
**Frontend File:** `app\reports\gst\gstr3b\page.tsx` (Line 51)
**Frontend Method:** GET
**Current Status:** ❌ Missing user_id (query param)

**Fix Required:**
Add `user_id` parameter (as query param).

### /reports/gst/gstr9

**API Endpoint:** `GET /reports/gst/gstr9`
**Expected Field:** user_id (query param)
**API File:** `app\api\reports\gst\gstr9\route.ts`
**Frontend File:** `app\reports\gst\gstr9\page.tsx` (Line 84)
**Frontend Method:** GET
**Current Status:** ❌ Missing user_id (query param)

**Fix Required:**
Add `user_id` parameter (as query param).

### /reports/profit-loss

**API Endpoint:** `GET /reports/profit-loss`
**Expected Field:** user_id (query param)
**API File:** `app\api\reports\profit-loss\route.ts`
**Frontend File:** `app\reports\profit-loss\page.tsx` (Line 141)
**Frontend Method:** GET
**Current Status:** ❌ Missing user_id (query param)

**Fix Required:**
Add `user_id` parameter (as query param).

### /reports/stock/valuation

**API Endpoint:** `GET /reports/stock/valuation`
**Expected Field:** user_id (query param)
**API File:** `app\api\reports\stock\valuation\route.ts`
**Frontend File:** `app\reports\stock\valuation\page.tsx` (Line 55)
**Frontend Method:** GET
**Current Status:** ❌ Missing user_id (query param)

**Fix Required:**
Add `user_id` parameter (as query param).

### /reports/trial-balance

**API Endpoint:** `GET /reports/trial-balance`
**Expected Field:** user_id (query param)
**API File:** `app\api\reports\trial-balance\route.ts`
**Frontend File:** `app\reports\trial-balance\page.tsx` (Line 81)
**Frontend Method:** GET
**Current Status:** ❌ Missing user_id (query param)

**Fix Required:**
Add `user_id` parameter (as query param).

### /settings/roles

**API Endpoint:** `POST /settings/roles`
**Expected Field:** created_by (body)
**API File:** `app\api\settings\roles\route.ts`
**Frontend File:** `app\settings\roles\page.tsx` (Line 165)
**Frontend Method:** POST
**Current Status:** ❌ Missing created_by (body)

**Current Body:**
```typescript
{
          business_id: business.id,
          role_name: newRoleName.trim(
```

**Fix Required:**
Add `created_by: user?.id` to the request body.

### /suppliers

**API Endpoint:** `GET /suppliers`
**Expected Field:** user_id (query param)
**API File:** `app\api\suppliers\route.ts`
**Frontend File:** `app\items\new\page.tsx` (Line 270)
**Frontend Method:** GET
**Current Status:** ❌ Missing user_id (query param)

**Fix Required:**
Add `user_id` parameter (as query param).

**API Endpoint:** `GET /suppliers`
**Expected Field:** user_id (query param)
**API File:** `app\api\suppliers\route.ts`
**Frontend File:** `app\suppliers\page.tsx` (Line 62)
**Frontend Method:** GET
**Current Status:** ❌ Missing user_id (query param)

**Fix Required:**
Add `user_id` parameter (as query param).

## 📊 Summary by Frontend File

### app\accounts\page.tsx
**Missing Cases:** 1
- GET /accounts - Missing user_id (query param)

### app\credit-notes\page.tsx
**Missing Cases:** 1
- GET /credit-notes - Missing user_id (query param)

### app\credit-notes\new\page.tsx
**Missing Cases:** 1
- POST /credit-notes - Missing created_by (body)

### app\customers\page.tsx
**Missing Cases:** 1
- GET /customers - Missing user_id (query param)

### app\debit-notes\new\page.tsx
**Missing Cases:** 1
- POST /debit-notes - Missing created_by (body)

### app\attendance\kiosk\page.tsx
**Missing Cases:** 1
- GET /employees/attendance - Missing user_id (query param)

### app\employees\attendance\page.tsx
**Missing Cases:** 1
- GET /employees/attendance - Missing user_id (query param)

### app\employees\attendance\mark\page.tsx
**Missing Cases:** 1
- POST /employees/attendance - Missing created_by (body)

### app\employees\expenses\page.tsx
**Missing Cases:** 1
- GET /employees/expenses - Missing user_id (query param)

### app\employees\expenses\new\page.tsx
**Missing Cases:** 1
- POST /employees/expenses - Missing created_by (body)

### app\employees\leaves\page.tsx
**Missing Cases:** 1
- GET /employees/leave-requests - Missing user_id (query param)

### app\employees\page.tsx
**Missing Cases:** 1
- GET /employees - Missing user_id (query param)

### app\settings\commission-rules\page.tsx
**Missing Cases:** 1
- GET /employees - Missing user_id (query param)

### app\employees\new\page.tsx
**Missing Cases:** 1
- POST /employees - Missing created_by (body)

### app\employees\salary\advances\page.tsx
**Missing Cases:** 1
- GET /employees/salary/advances - Missing user_id (query param)

### app\employees\salary\advances\new\page.tsx
**Missing Cases:** 1
- POST /employees/salary/advances - Missing user_id (body)

### app\employees\salary\payments\page.tsx
**Missing Cases:** 1
- GET /employees/salary/payments - Missing user_id (query param)

### app\inventory-adjustments\page.tsx
**Missing Cases:** 1
- GET /inventory-adjustments - Missing user_id (query param)

### app\inventory-adjustments\new\page.tsx
**Missing Cases:** 1
- POST /inventory-adjustments - Missing created_by (body)

### components\whatsapp\SendRemindersTab.tsx
**Missing Cases:** 1
- GET /invoices/for-reminders - Missing user_id (query param)

### app\invoices\new\page.tsx
**Missing Cases:** 1
- POST /invoices - Missing created_by (body)

### app\items\page.tsx
**Missing Cases:** 1
- GET /items - Missing user_id (query param)

### app\purchases\requests\page.tsx
**Missing Cases:** 1
- GET /items - Missing user_id (query param)

### app\items\new\page.tsx
**Missing Cases:** 2
- POST /items - Missing created_by (body)
- GET /suppliers - Missing user_id (query param)

### app\journal-entries\page.tsx
**Missing Cases:** 1
- GET /journal-entries - Missing user_id (query param)

### app\purchases\page.tsx
**Missing Cases:** 1
- GET /purchases - Missing user_id (query param)

### app\purchases\new\page.tsx
**Missing Cases:** 1
- POST /purchases - Missing created_by (body)

### app\reports\aging\payables\page.tsx
**Missing Cases:** 1
- GET /reports/aging/payables - Missing user_id (query param)

### app\reports\aging\receivables\page.tsx
**Missing Cases:** 1
- GET /reports/aging/receivables - Missing user_id (query param)

### app\reports\balance-sheet\page.tsx
**Missing Cases:** 1
- GET /reports/balance-sheet - Missing user_id (query param)

### app\reports\cash-flow\page.tsx
**Missing Cases:** 1
- GET /reports/cash-flow - Missing user_id (query param)

### app\reports\gst\gstr1\page.tsx
**Missing Cases:** 1
- GET /reports/gst/gstr1 - Missing user_id (query param)

### app\reports\gst\gstr2b\page.tsx
**Missing Cases:** 1
- GET /reports/gst/gstr2b - Missing user_id (query param)

### app\reports\gst\gstr3b\page.tsx
**Missing Cases:** 1
- GET /reports/gst/gstr3b - Missing user_id (query param)

### app\reports\gst\gstr9\page.tsx
**Missing Cases:** 1
- GET /reports/gst/gstr9 - Missing user_id (query param)

### app\reports\profit-loss\page.tsx
**Missing Cases:** 1
- GET /reports/profit-loss - Missing user_id (query param)

### app\reports\stock\valuation\page.tsx
**Missing Cases:** 1
- GET /reports/stock/valuation - Missing user_id (query param)

### app\reports\trial-balance\page.tsx
**Missing Cases:** 1
- GET /reports/trial-balance - Missing user_id (query param)

### app\settings\roles\page.tsx
**Missing Cases:** 1
- POST /settings/roles - Missing created_by (body)

### app\suppliers\page.tsx
**Missing Cases:** 1
- GET /suppliers - Missing user_id (query param)

## ✅ Quick Fix Checklist

For each missing case above, add the required field:

```typescript
// For POST requests:
body: JSON.stringify({
  ...formData,
  business_id: business.id,
  created_by: user?.id,  // ✅ Add this
  // ... other fields
})

// For PATCH/PUT requests:
body: JSON.stringify({
  ...formData,
  updated_by: user?.id,  // ✅ Add this
  // ... other fields
})

// For GET requests:
const params = new URLSearchParams();
params.append('business_id', business.id);
params.append('user_id', user.id);  // ✅ Add this
```
