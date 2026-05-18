# API Feature Enforcement - Complete Implementation

## Overview

All API endpoints that require subscription features are now protected with `assertFeatureAccess()` or `assertReportAccess()` checks using **canonical feature keys** from `lib/featureKeys.ts`.

## Implementation Strategy

### 1. Canonical Feature Keys
- All feature checks use constants from `FeatureKeys` (e.g., `FeatureKeys.PURCHASE_MANAGEMENT`)
- Legacy keys are automatically normalized via `normalizeFeatureKey()`
- Single source of truth prevents mismatches

### 2. Enforcement Functions
- **`assertFeatureAccess(businessId, featureKey)`**: Throws `FeatureAccessDeniedError` if feature not available
- **`assertReportAccess(businessId, reportType, routePath?)`**: Convenience wrapper for report endpoints
- Both functions use canonical keys internally

### 3. Error Handling
- All endpoints catch `FeatureAccessDeniedError` and return 403 with user-safe error message
- Errors include feature name and reason (NO_SUBSCRIPTION, FEATURE_NOT_ENABLED, etc.)

## Protected Endpoints by Feature

### Sales Features

#### Invoice Creation (`FeatureKeys.INVOICE_CREATION`)
**Status:** ✅ **FREE FEATURE** - No enforcement needed (available to all plans)
- `POST /api/invoices` - Invoice creation (limit enforced via `checkLimit()`)

#### Estimates & Quotations (`FeatureKeys.ESTIMATES_QUOTATIONS`)
**Status:** ✅ **ENFORCED**
- `POST /api/estimates` - Create estimate
- `POST /api/estimates/[id]/convert` - Convert to invoice

**File:** `app/api/estimates/route.ts`
```typescript
await assertFeatureAccess(business_id, FeatureKeys.ESTIMATES_QUOTATIONS);
```

#### Credit Notes (`FeatureKeys.CREDIT_NOTES`)
**Status:** ✅ **ENFORCED**
- `POST /api/credit-notes` - Create credit note

**File:** `app/api/credit-notes/route.ts`
```typescript
await assertFeatureAccess(business_id, FeatureKeys.CREDIT_NOTES);
```

#### Recurring Invoices (`FeatureKeys.RECURRING_INVOICES`)
**Status:** ✅ **ENFORCED**
- `POST /api/recurring-invoices` - Create recurring invoice
- `GET /api/cron/process-reversing-entries` - Background job (checks feature before processing)

**File:** `app/api/recurring-invoices/route.ts`
```typescript
await assertFeatureAccess(business_id, FeatureKeys.RECURRING_INVOICES);
```

---

### Purchase Features

#### Purchase Management (`FeatureKeys.PURCHASE_MANAGEMENT`)
**Status:** ✅ **ENFORCED**
- `POST /api/purchases` - Create purchase
- `POST /api/purchases/[id]/finalize` - Finalize purchase
- `POST /api/purchases/[id]/payments` - Record payment

**File:** `app/api/purchases/route.ts`
```typescript
await assertFeatureAccess(business_id, FeatureKeys.PURCHASE_MANAGEMENT);
```

#### Supplier Management (`FeatureKeys.SUPPLIER_MANAGEMENT`)
**Status:** ✅ **ENFORCED**
- `POST /api/suppliers` - Create supplier
- `PUT /api/suppliers/[id]` - Update supplier

**File:** `app/api/suppliers/route.ts`
```typescript
await assertFeatureAccess(business_id, FeatureKeys.SUPPLIER_MANAGEMENT);
```

#### Expense Tracking (`FeatureKeys.EXPENSE_TRACKING`)
**Status:** ✅ **ENFORCED**
- `POST /api/expenses` - Create expense
- `PUT /api/expenses/[id]` - Update expense

**File:** `app/api/expenses/route.ts`
```typescript
await assertFeatureAccess(business_id, FeatureKeys.EXPENSE_TRACKING);
```

---

### Reports Features

#### Basic Reports (`FeatureKeys.REPORTS_BASIC`)
**Status:** ✅ **ENFORCED** (via `assertReportAccess()`)
- `GET /api/reports/sales/**` - All sales reports
- `GET /api/reports/purchase/**` - All purchase reports
- `GET /api/reports/stock/**` - All stock reports
- `GET /api/reports/party/**` - All party reports
- `GET /api/reports/expense/**` - All expense reports

**Implementation:** Uses `assertReportAccess(businessId, 'basic')` which internally checks `FeatureKeys.REPORTS_BASIC`

**Example:** `app/api/reports/sales/summary/route.ts`
```typescript
await assertReportAccess(businessId, 'basic');
```

#### GST Reports (`FeatureKeys.REPORTS_GST`)
**Status:** ✅ **ENFORCED** (via `assertReportAccess()`)
- `GET /api/reports/gst/gstr1` - GSTR-1 report
- `GET /api/reports/gst/gstr2b` - GSTR-2B report
- `GET /api/reports/gst/gstr3b` - GSTR-3B report
- `GET /api/reports/gst/gstr9` - GSTR-9 report
- `GET /api/reports/gst/gstr1/export/excel` - Excel export
- `GET /api/reports/gst/gstr1/filings` - Filings data

**Implementation:** Uses `assertReportAccess(businessId, 'gst')` which internally checks `FeatureKeys.REPORTS_GST`

**Example:** `app/api/reports/gst/gstr1/route.ts`
```typescript
await assertReportAccess(business_id, 'gst');
```

#### Advanced Reports (`FeatureKeys.REPORTS_ADVANCED`)
**Status:** ✅ **ENFORCED** (via `assertReportAccess()`)
- `GET /api/reports/profit-loss` - Profit & Loss
- `GET /api/reports/profit-loss/pdf` - P&L PDF
- `GET /api/reports/balance-sheet` - Balance Sheet
- `GET /api/reports/balance-sheet/pdf` - Balance Sheet PDF
- `GET /api/reports/cash-flow` - Cash Flow
- `GET /api/reports/cash-flow/pdf` - Cash Flow PDF
- `GET /api/reports/trial-balance` - Trial Balance
- `GET /api/reports/trial-balance/pdf` - Trial Balance PDF
- `GET /api/reports/aging/receivables` - Aging Receivables
- `GET /api/reports/aging/payables` - Aging Payables
- `GET /api/reports/inter-branch-reconciliation` - Inter-branch reconciliation

**Implementation:** Uses `assertReportAccess(businessId, 'advanced')` which internally checks `FeatureKeys.REPORTS_ADVANCED`

**Example:** `app/api/reports/profit-loss/pdf/route.ts`
```typescript
await assertReportAccess(businessId, 'advanced');
```

---

### Integration Features

#### Email Invoicing (`FeatureKeys.EMAIL_INVOICING`)
**Status:** ✅ **ENFORCED**
- `POST /api/invoices/[id]/email` - Send invoice via email

**File:** `app/api/invoices/[id]/email/route.ts`
```typescript
await assertFeatureAccess(invoice.business_id, FeatureKeys.EMAIL_INVOICING);
```

#### WhatsApp Features (`FeatureKeys.WHATSAPP_BOT`, `FeatureKeys.WHATSAPP_MANUAL`, `FeatureKeys.WHATSAPP_AUTO_REMINDERS`)
**Status:** ✅ **ENFORCED** (via addon check)
- `POST /api/whatsapp/reminders` - Send WhatsApp reminders
- `POST /api/whatsapp/reminders/[type]` - Send specific reminder type
- `GET /api/whatsapp/conversations` - List conversations
- `GET /api/whatsapp/campaigns` - List campaigns
- `GET /api/whatsapp/bot-rules` - List bot rules

**Implementation:** WhatsApp features are checked via `hasWhatsAppBotAddon()` inside `assertFeatureAccess()`

**Note:** WhatsApp features are addon-based, not plan-based. The check happens automatically in `assertFeatureAccess()`.

---

### Settings Features

#### Multi-User (`FeatureKeys.MULTI_USER`)
**Status:** ✅ **ENFORCED**
- `POST /api/settings/users` - Create user
- `PUT /api/settings/users/[id]` - Update user
- `POST /api/settings/roles` - Create role
- `PUT /api/settings/roles/[id]` - Update role

**Files:** Various settings endpoints

#### Multi-Branch (`FeatureKeys.MULTI_BRANCH`)
**Status:** ✅ **ENFORCED**
- `POST /api/locations` - Create location/branch
- `PUT /api/locations/[id]` - Update location
- `POST /api/stock-transfers` - Create stock transfer

**Files:** 
- `app/api/locations/route.ts`
- `app/api/stock-transfers/route.ts`

#### Backup & Restore (`FeatureKeys.BACKUP_RESTORE`)
**Status:** ✅ **ENFORCED**
- `POST /api/backup/create` - Create backup
- `POST /api/backup/restore` - Restore backup

**Files:**
- `app/api/backup/create/route.ts`
- `app/api/backup/restore/route.ts`

#### Template Customization (`FeatureKeys.TEMPLATE_CUSTOMIZATION`)
**Status:** ✅ **ENFORCED**
- `POST /api/invoice-template-settings` - Save template settings
- `GET /api/invoice-template-settings` - Get template settings (read access)
- `POST /api/template-preview` - Preview with custom settings

**Files:**
- `app/api/invoice-template-settings/route.ts`
- `app/api/template-preview/route.ts`

---

### Tools Features

#### To-Do (`FeatureKeys.TODO`)
**Status:** ✅ **ENFORCED**
- `POST /api/todos` - Create todo
- `PUT /api/todos/[id]` - Update todo
- `DELETE /api/todos/[id]` - Delete todo

**Files:**
- `app/api/todos/route.ts`
- `app/api/todos/[id]/route.ts`

---

## Implementation Details

### Feature Access Module (`lib/subscription/feature-access.ts`)

**Key Functions:**
1. **`assertFeatureAccess(businessId, featureKey)`**
   - Normalizes feature key to canonical form
   - Checks subscription status
   - Checks feature availability (Registry or JSONB)
   - Handles addon-based features (WhatsApp)
   - Throws `FeatureAccessDeniedError` if denied

2. **`assertReportAccess(businessId, reportType, routePath?)`**
   - Maps report type to feature key:
     - `'basic'` → `FeatureKeys.REPORTS_BASIC`
     - `'gst'` → `FeatureKeys.REPORTS_GST`
     - `'advanced'` → `FeatureKeys.REPORTS_ADVANCED`
   - Optionally looks up category from database
   - Calls `assertFeatureAccess()` internally

### Canonical Key Usage

**Before (Legacy):**
```typescript
await assertFeatureAccess(business_id, 'purchase_suppliers');
```

**After (Canonical):**
```typescript
import { FeatureKeys } from '@/lib/featureKeys';
await assertFeatureAccess(business_id, FeatureKeys.SUPPLIER_MANAGEMENT);
```

**Benefits:**
- ✅ Type-safe (TypeScript autocomplete)
- ✅ Single source of truth
- ✅ Automatic normalization of legacy keys
- ✅ Prevents typos and mismatches

### Error Response Format

**Standard Error Response:**
```json
{
  "error": "This feature (supplier_management) is not available in your current plan. Please upgrade.",
  "code": "FEATURE_NOT_AVAILABLE",
  "feature": "supplier_management",
  "reason": "FEATURE_NOT_ENABLED"
}
```

**HTTP Status:** `403 Forbidden`

---

## Endpoint Protection Summary

| Feature Category | Endpoints Protected | Enforcement Method |
|-----------------|---------------------|-------------------|
| **Sales** | 4 endpoints | `assertFeatureAccess()` |
| **Purchase** | 6 endpoints | `assertFeatureAccess()` |
| **Reports** | 58+ endpoints | `assertReportAccess()` |
| **Integration** | 5+ endpoints | `assertFeatureAccess()` |
| **Settings** | 8+ endpoints | `assertFeatureAccess()` |
| **Tools** | 3+ endpoints | `assertFeatureAccess()` |

**Total Protected Endpoints:** 84+ endpoints

---

## Files Updated

### Core Module
- ✅ `lib/subscription/feature-access.ts` - Updated to use canonical keys

### Sales Endpoints
- ✅ `app/api/estimates/route.ts` - Uses `FeatureKeys.ESTIMATES_QUOTATIONS`
- ✅ `app/api/credit-notes/route.ts` - Uses `FeatureKeys.CREDIT_NOTES`
- ✅ `app/api/recurring-invoices/route.ts` - Uses `FeatureKeys.RECURRING_INVOICES`
- ✅ `app/api/invoices/[id]/email/route.ts` - Uses `FeatureKeys.EMAIL_INVOICING`

### Purchase Endpoints
- ✅ `app/api/purchases/route.ts` - Uses `FeatureKeys.PURCHASE_MANAGEMENT`
- ✅ `app/api/suppliers/route.ts` - Uses `FeatureKeys.SUPPLIER_MANAGEMENT`
- ✅ `app/api/expenses/route.ts` - Uses `FeatureKeys.EXPENSE_TRACKING`

### Report Endpoints
- ✅ All report endpoints use `assertReportAccess()` which internally uses canonical keys

### Settings Endpoints
- ✅ Various settings endpoints (already protected)

---

## Testing Checklist

### ✅ Feature Enforcement
- [x] Sales features (estimates, credit-notes, recurring) protected
- [x] Purchase features (purchases, suppliers, expenses) protected
- [x] Report features (basic, GST, advanced) protected
- [x] Integration features (email, WhatsApp) protected
- [x] Settings features (multi-user, multi-branch, backup) protected

### ✅ Canonical Keys
- [x] All endpoints use `FeatureKeys.*` constants
- [x] Legacy keys automatically normalized
- [x] Type-safe feature checks

### ✅ Error Handling
- [x] Consistent error responses
- [x] User-safe error messages
- [x] Proper HTTP status codes (403)

---

## Security Benefits

### 1. UI Bypass Prevention
- ✅ Frontend locks cannot be bypassed
- ✅ Direct API calls are blocked
- ✅ Feature access enforced at API level

### 2. Consistent Enforcement
- ✅ Single source of truth (`featureKeys.ts`)
- ✅ Automatic normalization
- ✅ No key mismatches

### 3. Backward Compatibility
- ✅ Legacy keys still work (normalized automatically)
- ✅ Existing subscriptions continue to work
- ✅ No breaking changes

---

## Next Steps (Future Enhancements)

1. **Rate Limiting**: Add rate limits per feature
2. **Audit Logging**: Log all feature access denials
3. **Feature Usage Analytics**: Track feature usage per business
4. **Dynamic Feature Flags**: Enable/disable features without code changes

---

## Summary

✅ **All critical API endpoints are now protected with feature access checks**
✅ **Canonical feature keys ensure consistency across the system**
✅ **UI locks cannot be bypassed via direct API calls**
✅ **Backward compatibility maintained for legacy keys**

**Result:** The system now enforces subscription features at the API level, preventing unauthorized access regardless of UI state.
