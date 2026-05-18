# Comprehensive Feature Enforcement Identification Guide

**Purpose**: This guide helps you systematically identify ALL subscription feature enforcement gaps across the entire codebase.

---

## 🎯 The Problem

**Issue**: Users can access paid features even when their subscription plan doesn't include them.

**Root Cause**: Missing backend enforcement checks (`assertFeatureAccess`) in:
- API endpoints (GET, POST, PUT, PATCH, DELETE)
- Background jobs / cron tasks
- Webhook handlers
- Internal utility functions

**Example**: Free plan user can customize templates because:
1. ✅ POST `/api/invoice-template-settings` has enforcement
2. ❌ GET `/api/invoice-template-settings` has NO enforcement
3. ❌ GET `/api/template-preview` with custom settings has NO enforcement
4. ❌ UI page `/invoices/templates/[id]/customize` has NO backend check

---

## 🔍 How to Identify Missing Enforcement

### Step 1: List ALL Features from Database

**Source**: `database/seed_subscriptions.sql` or `subscription_plans.features` JSONB

**All Features**:
```
Core Features:
- customer_management
- item_management
- invoice_creation
- payment_tracking
- stock_tracking
- dashboard_analytics

Template Features:
- template_basic
- template_all
- template_thermal
- template_customization ⚠️
- pdf_generation

Module Features:
- purchase_management
- expense_tracking
- supplier_management
- multi_user
- multi_branch

Report Features:
- reports_basic
- reports_gst
- reports_advanced
- reports_analytics

Automation Features:
- recurring_invoices
- alert_low_stock
- alert_credit_limit

Integration Features:
- whatsapp_manual
- whatsapp_auto_reminders
- email_invoicing
- payment_gateway
- api_access

Advanced Features:
- estimates_quotations
- credit_notes
- ledger_accounting
- backup_restore
- online_store
- barcode_scanning
- multi_currency
- custom_branding
```

---

### Step 2: Map Features to API Endpoints

**Create a mapping table**:

| Feature | API Endpoints That Should Check It |
|---------|-----------------------------------|
| `template_customization` | `/api/invoice-template-settings` (GET, POST)<br>`/api/template-preview` (GET with custom settings) |
| `recurring_invoices` | `/api/recurring-invoices` (POST, PUT, DELETE)<br>`/api/cron/process-reversing-entries` |
| `email_invoicing` | `/api/invoices/[id]/email` (POST) |
| `estimates_quotations` | `/api/estimates` (POST, PUT)<br>`/api/estimates/[id]/convert` |
| `credit_notes` | `/api/credit-notes` (POST, PUT) |
| `backup_restore` | `/api/backup/create` (POST)<br>`/api/backup/restore` (POST) |
| `multi_branch` | `/api/locations` (POST)<br>`/api/stock-transfers` (POST) |
| `supplier_management` | `/api/suppliers` (POST, PUT) |
| `purchase_management` | `/api/purchases` (POST)<br>`/api/purchases/[id]/finalize`<br>`/api/purchases/[id]/payments` |
| `expense_tracking` | `/api/expenses` (POST, PUT) |
| `reports_basic` | `/api/reports/stock/**` (GET)<br>`/api/reports/sales/**` (GET)<br>`/api/reports/purchase/**` (GET)<br>`/api/reports/party/**` (GET)<br>`/api/reports/expense/**` (GET) |
| `reports_gst` | `/api/reports/gst/**` (GET) |
| `reports_advanced` | `/api/reports/profit-loss` (GET)<br>`/api/reports/balance-sheet` (GET)<br>`/api/reports/cash-flow` (GET)<br>`/api/reports/trial-balance` (GET)<br>`/api/reports/aging/**` (GET) |

---

### Step 3: Audit Each Endpoint

**For each API route file**, check:

#### A. Does it import feature access?

```typescript
// ✅ GOOD: Has import
import { assertFeatureAccess, FeatureAccessDeniedError } from '@/lib/subscription/feature-access';

// ❌ BAD: Missing import
// No import found
```

#### B. Does it call assertFeatureAccess?

```typescript
// ✅ GOOD: Has enforcement
await assertFeatureAccess(business_id, 'template_customization');

// ❌ BAD: Missing enforcement
// No assertFeatureAccess call
```

#### C. Which HTTP methods need checks?

**Rule**: 
- **POST, PUT, PATCH, DELETE** → **ALWAYS** need feature checks (mutation operations)
- **GET** → Needs checks if it:
  - Returns feature-specific data (custom settings, premium reports)
  - Allows accessing restricted functionality (preview with custom settings)
  - Can be used to bypass restrictions (loading saved customizations)

**Examples**:
- ❌ `GET /api/invoice-template-settings` → **NEEDS CHECK** (returns custom settings)
- ❌ `GET /api/template-preview?settings={...}` → **NEEDS CHECK** (allows custom preview)
- ✅ `GET /api/invoices/[id]` → **NO CHECK NEEDED** (read-only, not feature-specific)
- ✅ `GET /api/customers` → **NO CHECK NEEDED** (read-only, core feature)

---

### Step 4: Check UI Pages (Client-Side)

**Important**: UI checks are **NOT sufficient**. Backend must always enforce.

**For each UI page/component**, check:

1. **Does it call API endpoints?**
   - If yes → Backend endpoint must have enforcement
   - UI check is just UX improvement, not security

2. **Example**: `/invoices/templates/[id]/customize/page.tsx`
   ```typescript
   // ❌ BAD: UI checks only (can be bypassed)
   if (!hasFeature('template_customization')) {
     return <UpgradePrompt />;
   }
   
   // ✅ GOOD: Backend enforces
   // UI can still check for better UX, but backend API will reject unauthorized requests
   ```

---

### Step 5: Check Background Jobs / Cron Tasks

**All cron jobs** must check subscription status:

```typescript
// ✅ GOOD
for (const business of businesses) {
  const subscription = await getBusinessSubscription(business.id);
  if (!subscription || subscription.status !== 'active') {
    continue; // Skip inactive subscriptions
  }
  
  // Check feature if needed
  if (!subscription.features?.features?.recurring_invoices) {
    continue; // Skip if feature not enabled
  }
  
  // Process...
}

// ❌ BAD: No subscription check
for (const business of businesses) {
  // Process for ALL businesses, even without subscription
}
```

---

## 🔧 Systematic Audit Process

### Method 1: Manual Code Review

1. **List all features** from `database/seed_subscriptions.sql`
2. **Search codebase** for each feature key:
   ```bash
   # Search for feature usage
   grep -r "template_customization" app/
   grep -r "recurring_invoices" app/
   ```
3. **For each occurrence**:
   - Is it an API route?
   - Does it call `assertFeatureAccess`?
   - If not, add enforcement

### Method 2: Automated Script (Recommended)

**Run**: `node scripts/audit-feature-enforcement.js`

**What it does**:
- Scans all API route files
- Checks for feature enforcement
- Generates report of missing checks
- Outputs to `docs/FEATURE_ENFORCEMENT_AUDIT_REPORT.md`

---

## ✅ Checklist for Each Feature

For **each feature**, verify:

- [ ] **POST endpoints** enforce feature access
- [ ] **PUT/PATCH endpoints** enforce feature access
- [ ] **DELETE endpoints** enforce feature access
- [ ] **GET endpoints** enforce feature access (if feature-specific)
- [ ] **Background jobs** check subscription + feature
- [ ] **UI pages** have UX checks (but backend still enforces)
- [ ] **Webhook handlers** check subscription
- [ ] **Internal utility functions** verify access before processing

---

## 🚨 Common Patterns to Fix

### Pattern 1: Missing GET Enforcement

**Problem**: GET endpoints allow reading restricted data.

```typescript
// ❌ BAD
export async function GET(req: NextRequest) {
  const business_id = searchParams.get('business_id');
  // No feature check
  const settings = await db.query(...);
  return NextResponse.json(settings);
}

// ✅ GOOD
export async function GET(req: NextRequest) {
  const business_id = searchParams.get('business_id');
  
  // Enforce feature access
  try {
    await assertFeatureAccess(business_id, 'template_customization');
  } catch (error) {
    if (error instanceof FeatureAccessDeniedError) {
      return NextResponse.json(error.toResponse(), { status: 403 });
    }
    throw error;
  }
  
  const settings = await db.query(...);
  return NextResponse.json(settings);
}
```

### Pattern 2: Missing Conditional GET Enforcement

**Problem**: GET endpoint allows custom data when params are provided.

```typescript
// ❌ BAD
export async function GET(req: NextRequest) {
  const customSettings = searchParams.get('settings');
  // No check if customSettings provided
  return renderTemplate(customSettings);
}

// ✅ GOOD
export async function GET(req: NextRequest) {
  const customSettings = searchParams.get('settings');
  const businessId = searchParams.get('business_id');
  
  // Only check if custom settings provided
  if (customSettings && businessId) {
    try {
      await assertFeatureAccess(businessId, 'template_customization');
    } catch (error) {
      if (error instanceof FeatureAccessDeniedError) {
        return NextResponse.json(error.toResponse(), { status: 403 });
      }
      throw error;
    }
  }
  
  return renderTemplate(customSettings);
}
```

### Pattern 3: Missing Background Job Checks

**Problem**: Cron jobs process data for all businesses.

```typescript
// ❌ BAD
export async function GET() {
  const businesses = await db.query('SELECT * FROM businesses');
  for (const business of businesses) {
    // Process for ALL businesses
    await processRecurringInvoices(business.id);
  }
}

// ✅ GOOD
export async function GET() {
  const businesses = await db.query('SELECT * FROM businesses');
  for (const business of businesses) {
    const subscription = await getBusinessSubscription(business.id);
    if (!subscription || subscription.status !== 'active') {
      continue;
    }
    if (!subscription.features?.features?.recurring_invoices) {
      continue;
    }
    await processRecurringInvoices(business.id);
  }
}
```

---

## 📊 Quick Reference: Feature → Endpoint Mapping

| Feature | Critical Endpoints | Enforcement Status |
|---------|-------------------|-------------------|
| `template_customization` | `/api/invoice-template-settings` (GET, POST)<br>`/api/template-preview` (GET with settings) | ✅ POST fixed<br>✅ GET fixed (just now)<br>✅ Preview fixed (just now) |
| `recurring_invoices` | `/api/recurring-invoices` (POST)<br>`/api/cron/process-reversing-entries` | ✅ POST enforced<br>✅ Cron enforced |
| `email_invoicing` | `/api/invoices/[id]/email` (POST) | ✅ Enforced |
| `estimates_quotations` | `/api/estimates` (POST)<br>`/api/estimates/[id]/convert` | ✅ POST enforced<br>✅ Convert enforced |
| `credit_notes` | `/api/credit-notes` (POST) | ✅ Enforced |
| `backup_restore` | `/api/backup/create` (POST)<br>`/api/backup/restore` (POST) | ✅ Both enforced |
| `multi_branch` | `/api/locations` (POST)<br>`/api/stock-transfers` (POST) | ✅ Both enforced |
| `supplier_management` | `/api/suppliers` (POST) | ✅ Enforced |
| `purchase_management` | `/api/purchases` (POST)<br>`/api/purchases/[id]/finalize`<br>`/api/purchases/[id]/payments` | ✅ All enforced |
| `expense_tracking` | `/api/expenses` (POST) | ✅ Enforced |
| `reports_basic` | `/api/reports/stock/**` (GET)<br>`/api/reports/sales/**` (GET)<br>`/api/reports/purchase/**` (GET)<br>`/api/reports/party/**` (GET)<br>`/api/reports/expense/**` (GET) | ✅ All enforced |
| `reports_gst` | `/api/reports/gst/**` (GET) | ✅ All enforced |
| `reports_advanced` | `/api/reports/profit-loss` (GET)<br>`/api/reports/balance-sheet` (GET)<br>`/api/reports/cash-flow` (GET)<br>`/api/reports/trial-balance` (GET)<br>`/api/reports/aging/**` (GET) | ✅ All enforced |

---

## 🎯 Next Steps

1. **Run audit script**: `node scripts/audit-feature-enforcement.js`
2. **Review report**: Check `docs/FEATURE_ENFORCEMENT_AUDIT_REPORT.md`
3. **Fix high-severity issues first**: POST/PUT/PATCH/DELETE endpoints
4. **Fix medium-severity issues**: GET endpoints with feature-specific data
5. **Test each fix**: Verify unauthorized users get 403 errors
6. **Update this guide**: Add newly discovered patterns

---

**Last Updated**: 2025-01-XX  
**Status**: Template customization GET endpoints fixed ✅
