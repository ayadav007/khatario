# SUBSCRIPTION & FEATURE ACCESS SYSTEM AUDIT REPORT

**Date:** 2026-01-21  
**Auditor:** Senior SaaS Architect  
**Scope:** Full system audit of subscription assignment, feature matrix, sidebar rendering, route guards, and API enforcement

---

## PART 1 — REGISTRATION FLOW AUDIT

### 1.1 Business & User Registration Flow

**File:** `app/api/signup/route.ts`

**Flow Sequence:**
1. **Line 54-67:** Business is created → `INSERT INTO businesses`
2. **Line 73-119:** Default roles and permissions are created
3. **Line 123-141:** Default branch is created
4. **Line 143-152:** User (Primary Admin) is created
5. **Line 234-298:** **Subscription assignment logic exists**

### 1.2 Subscription Assignment at Registration

**Location:** `app/api/signup/route.ts:234-298`

**Current Implementation:**
- **Line 240-242:** Checks if 'free' plan exists in `subscription_plans` table
- **Line 248-260:** If free plan exists:
  - Checks for existing subscription (line 257-259)
  - If exists and wrong plan, updates to 'free' (line 267-273)
  - If doesn't exist, creates new subscription with `plan_id = 'free'` (line 280-284)
- **Line 290-297:** If free plan NOT found, logs warning but **does NOT create subscription**

**CRITICAL FINDING:**
- Subscription creation is **CONDITIONAL** on 'free' plan existing in database
- If `subscription_plans` table is empty or 'free' plan missing, **NO subscription is created**
- Transaction commits even if subscription creation fails (line 301)

### 1.3 Lazy Subscription Assignment

**Location:** `lib/subscription.ts:232-281`

**Implementation:**
- **Line 232-275:** `checkLimit()` function auto-assigns 'free' plan if no subscription exists
- This is a **FALLBACK MECHANISM**, not primary assignment
- Only triggers when `checkLimit()` is called (e.g., when creating invoices, customers, etc.)
- **Impact:** New businesses may appear without subscription until they try to use a feature that checks limits

**Root Cause:**
- Registration flow depends on 'free' plan existing in database
- No validation that subscription was actually created
- Lazy assignment in `checkLimit()` is a workaround, not a solution

---

## PART 2 — SUBSCRIPTION DATA FLOW

### 2.1 Subscription Fetching

**Primary Function:** `lib/subscription.ts:49-146` - `getBusinessSubscription()`

**Caching Behavior:**
- **Line 54-59:** In-memory cache with 5-minute TTL (`SUBSCRIPTION_CACHE_TTL = 5 * 60 * 1000`)
- Cache key: `businessId`
- Cache structure: `{ subscription: BusinessSubscription | null, timestamp: number }`

**Data Sources (Priority Order):**
1. **Cache** (if valid)
2. **Database Query** (line 62-80):
   - Joins `business_subscriptions` with `subscription_plans`
   - Filters: `status = 'active'`
   - Merges Limits Registry data (line 92-123)

### 2.2 API Endpoints Returning Subscription Data

**1. GET `/api/subscriptions/current`**
- **File:** `app/api/subscriptions/current/route.ts:10-136`
- **Returns:** Full subscription object with merged features (JSONB + Registry)
- **Used by:** Frontend to display subscription status

**2. GET `/api/features/enabled`**
- **File:** (Referenced in `hooks/useFeatureRegistry.ts:40-41`)
- **Returns:** Enabled feature IDs and categories
- **Used by:** Sidebar to determine feature locks

**3. GET `/api/admin/subscriptions/plans`**
- **File:** `app/api/admin/subscriptions/plans/route.ts:11-117`
- **Returns:** All subscription plans with merged registry data
- **Used by:** Admin Feature Matrix UI

### 2.3 Frontend Subscription Data

**Context:** `contexts/LayoutDataContext.tsx` (referenced in Sidebar.tsx:49)
- Provides `subscription` object to components
- Structure: `{ features: { features: Record<string, boolean>, limits: {...} } }`

**Data Flow:**
1. Frontend fetches from `/api/subscriptions/current`
2. Stored in `LayoutDataContext`
3. Used by `Sidebar.tsx` for feature checks (line 225-243)

**Potential Issues:**
- Cache may serve stale data (5-minute TTL)
- No cache invalidation on subscription updates
- Frontend may not refresh after subscription changes

---

## PART 3 — FEATURE MATRIX AUDIT

### 3.1 Feature Matrix Admin UI

**Location:** `app/api/admin/subscriptions/plans/route.ts`

**POST Handler (Line 123-184):**
- Updates subscription plan JSONB features
- **DOES NOT update Feature Registry** (`subscription_plan_features` table)
- Only updates JSONB column in `subscription_plans` table

**GET Handler (Line 11-117):**
- Merges Feature Registry (`subscription_plan_features`) with JSONB
- **Registry-first approach:** If registry has data, it's merged into JSONB structure

### 3.2 Feature Registry System

**Tables:**
1. `platform_features` - Master list of all features
2. `subscription_plan_features` - Maps features to plans (enabled/disabled)
3. `subscription_plan_limits` - Maps limits to plans

**Registry vs JSONB:**
- **Registry (New System):** Normalized tables for features and limits
- **JSONB (Legacy):** Features stored as JSON in `subscription_plans.features`
- **Current State:** Hybrid system - Registry is merged into JSONB for backward compatibility

### 3.3 Feature Keys Consistency

**From Seed File:** `database/seed_subscriptions.sql:69-107`

**Free Plan Features (JSONB):**
```json
{
  "features": {
    "customer_management": true,
    "item_management": true,
    "invoice_creation": true,
    "payment_tracking": true,
    "stock_tracking": true,
    "template_basic": true,
    "pdf_generation": true,
    // All others: false
  }
}
```

**Key Mismatches Identified:**
- Sidebar uses: `purchase_management`
- JSONB may use: `purchase_management` (from seed)
- Registry may use: Different key structure

**Missing Information:**
- Exact feature keys in `platform_features` table
- Mapping between registry IDs and JSONB keys
- Admin UI location for toggling features (not found in audit)

---

## PART 4 — SIDEBAR AUDIT

### 4.1 Sidebar Configuration

**File:** `components/layout/Sidebar.tsx`

**Feature Check Logic (Line 199-244):**
1. **WhatsApp Features:** Check addon first (line 201-206)
2. **Feature Registry:** If `featureRegistry.source === 'registry'` (line 215-221)
3. **JSONB Fallback:** Check `subscription.features.features[featureKey]` (line 225-243)

### 4.2 Sidebar Items with Feature Keys

**Critical Items:**

| Sidebar Item | Display Name | Feature Key Used | Lock Condition | Route Path |
|-------------|--------------|------------------|----------------|------------|
| Purchases | "Purchases" | `purchase_management` (legacy map) | `!hasFeature('purchase_management')` | `/purchases` |
| Suppliers | "Suppliers" | `purchase_suppliers` (legacy map) | Route-based check | `/suppliers` |
| Expenses | "Expenses" | `purchase_expenses` (legacy map) | Route-based check | `/expenses` |
| Credit Notes | "Credit Notes" | `sales_credit_notes` (legacy map) | Route-based check | `/credit-notes` |
| Reports | "Reports" | `reports_basic`, `reports_gst`, `reports_advanced` | Route-based check | `/reports/*` |
| To Do | "To Do List" | `todo` → `tools_todo` (mapped) | `isLocked: !hasFeature('todo')` | `/tools/todo` |

### 4.3 Feature Key Mappings

**Legacy Mapping (Line 228-240):**
```typescript
{
  'sales_invoices': 'invoice_creation',
  'sales_estimates': 'estimates_quotations',
  'sales_credit_notes': 'credit_notes',
  'sales_recurring_invoices': 'recurring_invoices',
  'purchase_suppliers': 'supplier_management',
  'purchase_expenses': 'expense_tracking',
  'settings_template_customization': 'template_customization',
  'settings_multi_user': 'multi_user',
  'settings_multi_branch': 'multi_branch',
  'settings_backup': 'backup_restore',
}
```

**Route-to-Feature Mapping (Line 60-169):**
- `/purchases` → `purchase_management`
- `/suppliers` → `purchase_suppliers`
- `/expenses` → `purchase_expenses`

### 4.4 Lock Detection Logic

**Line 898-906:**
1. Check explicit `isLocked` prop
2. Check route-based lock via `isRouteLocked()`
3. If locked, show lock icon and upgrade modal

**Issue Identified:**
- Purchase items use `module: 'purchases'` (RBAC) but feature check uses `purchase_management`
- **Mismatch:** RBAC module ≠ Feature key
- Sidebar may show item as unlocked (RBAC allows) but feature check fails

---

## PART 5 — ROUTE & PAGE ACCESS AUDIT

### 5.1 Route Guards

**Not Found:**
- No `withPageAuth` HOC found
- No `useAuthorizationGuard` hook found
- No middleware for route protection

**Implication:**
- Routes are **NOT protected** at page level
- Access control relies on:
  1. Sidebar hiding locked items
  2. API endpoints enforcing features
  3. Client-side checks in components

**Risk:**
- Users can access routes directly via URL even if feature is locked
- No server-side route protection

### 5.2 Route-to-Feature Mapping

**Legacy Map:** `components/layout/Sidebar.tsx:60-169`

**Key Routes:**
- `/purchases` → `purchase_management`
- `/purchases/new` → `purchase_management`
- `/suppliers` → `purchase_suppliers`
- `/expenses` → `purchase_expenses`
- `/credit-notes` → `sales_credit_notes`

**Database-Driven:** `components/layout/Sidebar.tsx:325-364`
- Fetches from `/api/admin/reports`
- Builds `reportRouteMap` from database
- Falls back to legacy map if API fails

---

## PART 6 — API ENFORCEMENT AUDIT

### 6.1 Feature Enforcement Functions

**Location:** `lib/subscription.ts:420-441`

**Functions:**
1. `requireFeature(businessId, featureKey)` - Throws error if feature not enabled
2. `requireLimit(businessId, limitType)` - Throws error if limit exceeded

### 6.2 API Endpoint Protection

**Search Results:**
- **NO matches found** for `requireFeature` or `requireLimit` in `app/api/`

**Implication:**
- **API endpoints are NOT protected** by feature checks
- Endpoints may allow access to features that should be locked
- No enforcement at API level

**Risk:**
- Users can call API endpoints directly even if feature is locked in UI
- No server-side validation of feature access

---

## PART 7 — CONSOLIDATED MISMATCH REPORT

### 7.1 Feature Key Mismatch Table

| Feature Name | Feature Matrix Key | Sidebar Key | Route Key | Backend Key | Status |
|-------------|-------------------|-------------|-----------|-------------|--------|
| Purchase Management | `purchase_management` (JSONB) | `purchase_management` (mapped) | `purchase_management` | **NOT FOUND** | **MISMATCH** |
| Suppliers | `supplier_management` (JSONB) | `purchase_suppliers` (mapped) | `purchase_suppliers` | **NOT FOUND** | **MISMATCH** |
| Expenses | `expense_tracking` (JSONB) | `purchase_expenses` (mapped) | `purchase_expenses` | **NOT FOUND** | **MISMATCH** |
| Credit Notes | `credit_notes` (JSONB) | `sales_credit_notes` (mapped) | `sales_credit_notes` | **NOT FOUND** | **MISMATCH** |
| Invoices | `invoice_creation` (JSONB) | `sales_invoices` (mapped) | N/A | **NOT FOUND** | **MISMATCH** |

**Legend:**
- **OK:** All keys match
- **MISMATCH:** Keys differ across layers

### 7.2 Root Causes (Ranked by Severity)

#### **SEVERITY 1: CRITICAL**

**1. No Subscription at Registration**
- **Location:** `app/api/signup/route.ts:234-298`
- **Cause:** Conditional subscription creation depends on 'free' plan existing
- **Impact:** New businesses may have no subscription until lazy assignment triggers
- **Fix Required:** Ensure 'free' plan exists OR create subscription unconditionally

**2. No API-Level Feature Enforcement**
- **Location:** No `requireFeature()` calls found in API routes
- **Cause:** API endpoints don't check feature access
- **Impact:** Users can bypass UI locks by calling APIs directly
- **Fix Required:** Add `requireFeature()` checks to all protected endpoints

**3. No Route-Level Protection**
- **Location:** No route guards or middleware found
- **Cause:** Routes are not protected at page level
- **Impact:** Users can access locked features via direct URL
- **Fix Required:** Implement route guards or middleware

#### **SEVERITY 2: HIGH**

**4. Feature Key Mismatches**
- **Location:** Multiple files with different key naming conventions
- **Cause:** Legacy mapping between sidebar keys and JSONB keys
- **Impact:** Features may appear locked/unlocked incorrectly
- **Fix Required:** Standardize feature keys across all layers

**5. Stale Cache**
- **Location:** `lib/subscription.ts:54-59`
- **Cause:** 5-minute cache TTL, no invalidation on updates
- **Impact:** Frontend may show outdated subscription status
- **Fix Required:** Implement cache invalidation on subscription updates

#### **SEVERITY 3: MEDIUM**

**6. Hybrid Registry/JSONB System**
- **Location:** Multiple files merging registry and JSONB
- **Cause:** Transitioning from JSONB to Registry system
- **Impact:** Complexity and potential inconsistencies
- **Fix Required:** Complete migration to Registry or maintain clear fallback logic

**7. Lazy Subscription Assignment**
- **Location:** `lib/subscription.ts:232-275`
- **Cause:** Workaround for missing subscription at registration
- **Impact:** Delayed subscription assignment, potential race conditions
- **Fix Required:** Ensure subscription created at registration

### 7.3 Issue Attribution

**Missing Subscription at Registration:**
- **Primary Cause:** Conditional logic in signup route
- **Secondary Cause:** No validation that subscription was created
- **Workaround:** Lazy assignment in `checkLimit()`

**Feature Key Mismatches:**
- **Primary Cause:** Legacy mapping between different key naming conventions
- **Secondary Cause:** No centralized feature key registry
- **Impact:** Sidebar may show incorrect lock status

**No API/Route Protection:**
- **Primary Cause:** Missing enforcement functions in API routes
- **Secondary Cause:** No route guards implemented
- **Impact:** Security vulnerability - users can bypass UI locks

**Caching Issues:**
- **Primary Cause:** No cache invalidation mechanism
- **Secondary Cause:** Long TTL (5 minutes)
- **Impact:** Stale data shown to users

---

## SUMMARY

### Critical Issues Requiring Immediate Attention:

1. **Subscription not created at registration** - Fix signup route to ensure subscription is always created
2. **No API-level feature enforcement** - Add `requireFeature()` checks to all protected endpoints
3. **No route-level protection** - Implement route guards or middleware
4. **Feature key mismatches** - Standardize keys across all layers

### Recommended Next Steps:

1. **Fix Registration Flow:**
   - Ensure 'free' plan exists in database (run seed script)
   - Add validation that subscription was created
   - Remove dependency on conditional logic

2. **Implement API Protection:**
   - Audit all API endpoints that should be protected
   - Add `requireFeature()` checks
   - Add `requireLimit()` checks where applicable

3. **Implement Route Protection:**
   - Create `withPageAuth` HOC or middleware
   - Add feature checks before page render
   - Redirect to upgrade page if feature locked

4. **Standardize Feature Keys:**
   - Create centralized feature key registry
   - Update all mappings to use consistent keys
   - Document key naming conventions

5. **Fix Caching:**
   - Implement cache invalidation on subscription updates
   - Reduce TTL or use event-driven invalidation
   - Add cache refresh mechanism in frontend

---

**END OF AUDIT REPORT**
