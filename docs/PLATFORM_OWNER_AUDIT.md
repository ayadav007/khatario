# PLATFORM OWNER AUDIT: Subscription System Data-Driven vs Hard-Coded Analysis

**Date**: 2025-01-XX  
**Audit Type**: Read-Only Platform Flexibility Assessment  
**Status**: ✅ **COMPLETE**

---

## 🎯 EXECUTIVE SUMMARY

**Question**: "Are subscription rules (plans, features, limits) DATA-DRIVEN and ADMIN-CONTROLLABLE, or HARD-CODED in code?"

**Answer**: **MIXED** — Mostly data-driven with critical hard-coded exceptions.

### Verdict
- ✅ **Plan Definitions**: **DATA-DRIVEN** (stored in `subscription_plans` table)
- ✅ **Feature Flags**: **DATA-DRIVEN** (stored in `subscription_plans.features` JSONB)
- ✅ **Limit Values**: **DATA-DRIVEN** (stored in `subscription_plans.features.limits` JSONB)
- ❌ **Plan IDs**: **PARTIALLY HARD-CODED** (`'free'` plan ID hard-coded in `lib/subscription.ts`)
- ⚠️ **Report Type Mapping**: **HARD-CODED** (report type → feature key mapping in `assertReportAccess`)
- ⚠️ **UI Display Logic**: **HARD-CODED** (plan highlights, pricing display in `app/page.tsx`)

---

## 📊 DETAILED ANALYSIS

### 1️⃣ SOURCE OF TRUTH FOR PLAN DEFINITIONS

#### ✅ PLAN DEFINITIONS: **DATA-DRIVEN** (Database)

**Location**: `subscription_plans` table (PostgreSQL)

**Schema**:
```sql
CREATE TABLE subscription_plans (
    id VARCHAR(50) PRIMARY KEY,  -- 'free', 'professional', 'business', 'enterprise'
    name VARCHAR(100) NOT NULL,
    display_name VARCHAR(100) NOT NULL,
    description TEXT,
    price_monthly DECIMAL(10,2) DEFAULT 0,
    price_yearly DECIMAL(10,2) DEFAULT 0,
    currency VARCHAR(3) DEFAULT 'INR',
    features JSONB NOT NULL,  -- {"limits": {...}, "features": {...}}
    is_active BOOLEAN DEFAULT true,
    sort_order INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

**Evidence**:
- ✅ Plans stored in database (`database/schema.sql` lines 343-357)
- ✅ Seed script (`database/seed_subscriptions.sql`) inserts plans, but can be modified via admin
- ✅ Admin API exists: `POST /api/admin/subscriptions/plans` for create/update

**Verdict**: **YES** — Plans are stored in database and can be managed via admin API.

---

#### ✅ FEATURE ACCESS PER PLAN: **DATA-DRIVEN** (JSONB)

**Location**: `subscription_plans.features.features` (JSONB column)

**Structure**:
```json
{
  "features": {
    "recurring_invoices": true,
    "email_invoicing": false,
    "estimates_quotations": true,
    ...
  }
}
```

**Evidence**:
- ✅ Feature flags stored in `features.features` JSONB (`database/seed_subscriptions.sql` lines 78-247)
- ✅ `assertFeatureAccess()` reads dynamically from `subscription.features?.features?.[featureKey]` (`lib/subscription/feature-access.ts` line 144)
- ✅ No hard-coded plan-specific feature checks in enforcement code

**Verdict**: **YES** — Features are stored in JSONB and read dynamically. No hard-coded plan → feature mappings.

---

#### ✅ LIMITS PER PLAN: **DATA-DRIVEN** (JSONB)

**Location**: `subscription_plans.features.limits` (JSONB column)

**Structure**:
```json
{
  "limits": {
    "max_invoices_per_month": 20,
    "max_customers": 10,
    "max_items": 10,
    "max_users": 1,
    "max_whatsapp_per_day": 0
  }
}
```

**Evidence**:
- ✅ Limits stored in `features.limits` JSONB (`database/seed_subscriptions.sql` lines 71-77, 112-117, 154-159, 204-209)
- ✅ `checkLimit()` reads dynamically: `subscription.features?.limits` (`lib/subscription.ts` line 153)
- ✅ `checkLimitInTransaction()` reads dynamically: `limits.max_invoices_per_month` (`lib/subscription.ts` line 300)
- ❌ **NO hard-coded numeric limits** (20, 500, 999) in enforcement code

**Verdict**: **YES** — Limits are stored in JSONB and read dynamically. No hard-coded limit values.

---

### 2️⃣ ENFORCEMENT FUNCTION ANALYSIS

#### ✅ `assertFeatureAccess()`: **DATA-DRIVEN**

**File**: `lib/subscription/feature-access.ts` (lines 80-155)

**Analysis**:
```typescript
// Reads from subscription.features.features dynamically
const features = subscription.features?.features;
if (!features || features[featureKey] !== true) {
  throw new FeatureAccessDeniedError(...);
}
```

**Evidence**:
- ✅ Fetches subscription from DB: `getBusinessSubscription(businessId)` (line 108)
- ✅ Reads feature flags dynamically: `subscription.features?.features?.[featureKey]` (line 144)
- ✅ No hard-coded plan names (e.g., `plan_id === 'professional'`)
- ✅ No hard-coded feature lists per plan

**Verdict**: **YES** — Reads rules dynamically from database. No hard-coded plan checks.

---

#### ✅ `assertReportAccess()`: **MOSTLY DATA-DRIVEN** (with hard-coded mapping)

**File**: `lib/subscription/feature-access.ts` (lines 202-218)

**Analysis**:
```typescript
const featureMap: Record<'basic' | 'gst' | 'advanced', string> = {
  'basic': 'reports_basic',
  'gst': 'reports_gst',
  'advanced': 'reports_advanced'
};
```

**Evidence**:
- ✅ Report type → feature key mapping is hard-coded (lines 206-210)
- ✅ But feature access check itself is data-driven (calls `assertFeatureAccess`)
- ⚠️ **Issue**: If a new report type is added, code must be changed

**Verdict**: **PARTIAL** — Feature access is data-driven, but report type mapping is hard-coded.

---

#### ✅ `checkLimitInTransaction()`: **DATA-DRIVEN**

**File**: `lib/subscription.ts` (lines 261-349)

**Analysis**:
```typescript
// Reads limits from subscription_plans.features.limits dynamically
const limits = subscriptionResult.rows[0].limits;
maxLimit = parseInt(limits.max_invoices_per_month || '0', 10);
```

**Evidence**:
- ✅ Reads limits from DB: `sp.features->'limits'` (line 275)
- ✅ No hard-coded numeric limits
- ✅ Limit types are hard-coded (`'invoices' | 'customers' | 'items' | 'users' | 'whatsapp'`), but values are dynamic

**Verdict**: **YES** — Reads limit values dynamically from database. Limit types are fixed (acceptable for now).

---

### 3️⃣ HARD-CODED OCCURRENCES

#### ❌ **HARD-CODED PLAN ID: `'free'`**

**Location**: `lib/subscription.ts` (lines 122, 132, 134)

**Code**:
```typescript
const freePlan = await db.queryOne(`SELECT id FROM subscription_plans WHERE id = 'free'`);
// ...
VALUES ($1, 'free', 'active', CURRENT_DATE, CURRENT_DATE + INTERVAL '30 days')
// ...
plan_id = 'free',
```

**Impact**: 
- ⚠️ Auto-assignment logic assumes `'free'` plan exists
- ⚠️ If default plan ID changes, code must be updated
- ⚠️ Cannot easily rename or restructure default plan

**Severity**: **MEDIUM** — Functional but reduces flexibility.

**Recommendation**: 
- Option 1: Query for plan with `sort_order = 1` or `is_active = true ORDER BY sort_order LIMIT 1`
- Option 2: Store default plan ID in config/environment variable

---

#### ⚠️ **HARD-CODED REPORT TYPE MAPPING**

**Location**: `lib/subscription/feature-access.ts` (lines 206-210)

**Code**:
```typescript
const featureMap: Record<'basic' | 'gst' | 'advanced', string> = {
  'basic': 'reports_basic',
  'gst': 'reports_gst',
  'advanced': 'reports_advanced'
};
```

**Impact**:
- ⚠️ New report types require code changes
- ⚠️ Mapping is not configurable via admin

**Severity**: **LOW** — Acceptable if report types are stable.

**Recommendation**: 
- Option 1: Store mapping in `feature_flags` table with metadata
- Option 2: Use naming convention: `reports_{type}` (auto-map)

---

#### ⚠️ **HARD-CODED UI DISPLAY LOGIC**

**Location**: `app/page.tsx` (lines 48-84)

**Code**:
```typescript
const getPlanHighlights = (planId: string): string[] => {
  const highlights: Record<string, string[]> = {
    free: ['Up to 20 invoices/month', '10 customers & 10 items', ...],
    professional: ['Up to 500 invoices/month', ...],
    ...
  };
  return highlights[planId] || [];
};
```

**Impact**:
- ⚠️ Hard-coded marketing copy for each plan
- ⚠️ Limits shown in UI don't automatically update when DB limits change
- ⚠️ UI shows "20 invoices/month" even if DB limit is changed to 25

**Severity**: **LOW** — UI-only, doesn't affect enforcement.

**Recommendation**: 
- Option 1: Generate highlights dynamically from `plan.features.limits`
- Option 2: Store highlights in `subscription_plans.description` or new `highlights` JSONB column

---

#### ⚠️ **HARD-CODED LIMIT TYPE ENUMS**

**Location**: `lib/subscription.ts` (line 114, 264)

**Code**:
```typescript
limitType: 'invoices' | 'customers' | 'items' | 'users' | 'whatsapp'
```

**Impact**:
- ⚠️ New limit types (e.g., `max_projects`, `max_storage_gb`) require code changes
- ⚠️ TypeScript enum restricts flexibility

**Severity**: **LOW** — Acceptable if limit types are stable.

**Recommendation**: 
- Option 1: Store limit types in `feature_flags` table with `category = 'limits'`
- Option 2: Use string type and validate against DB schema

---

### 4️⃣ NEW PLAN / FEATURE / LIMIT FLEXIBILITY

#### ✅ **Can a new plan be added without code changes?**

**Answer**: **YES** (with one exception)

**Process**:
1. Insert new plan into `subscription_plans` table via admin API: `POST /api/admin/subscriptions/plans`
2. Set `features` JSONB with limits and feature flags
3. Enforcement functions will automatically work (`assertFeatureAccess`, `checkLimit`)
4. ⚠️ Exception: If plan uses new limit types, `checkLimit()` enum must be updated

**Evidence**:
- ✅ `getBusinessSubscription()` queries by `plan_id` (any string value)
- ✅ `assertFeatureAccess()` checks `features[featureKey]` (any feature key)
- ✅ `checkLimit()` reads `limits.max_invoices_per_month` (any limit key)

**Verdict**: **YES** — New plans work without code changes (except limit type enums).

---

#### ✅ **Can features be enabled/disabled per plan without redeploy?**

**Answer**: **YES**

**Process**:
1. Update `subscription_plans.features.features` JSONB via admin API
2. Changes take effect immediately (no redeploy needed)
3. Enforcement functions read from DB on every request

**Evidence**:
- ✅ `assertFeatureAccess()` queries DB: `getBusinessSubscription(businessId)`
- ✅ Feature check: `subscription.features?.features?.[featureKey]`
- ✅ No caching in enforcement functions (except WhatsApp addon cache, 5min TTL)

**Verdict**: **YES** — Features can be toggled per plan without redeploy.

---

#### ✅ **Can limits be changed without redeploy?**

**Answer**: **YES**

**Process**:
1. Update `subscription_plans.features.limits` JSONB via admin API
2. Changes take effect immediately (no redeploy needed)
3. Enforcement functions read from DB on every request

**Evidence**:
- ✅ `checkLimit()` queries DB: `getBusinessSubscription(businessId)`
- ✅ Limit check: `limits.max_invoices_per_month`
- ✅ No hard-coded limit values in enforcement code

**Verdict**: **YES** — Limits can be changed without redeploy.

---

### 5️⃣ ADMIN CAPABILITIES

#### ✅ **Admin UI / API for Managing Plans**

**Answer**: **YES** (Partially)

**Admin API Endpoints**:
- ✅ `GET /api/admin/subscriptions/plans` — Fetch all plans
- ✅ `POST /api/admin/subscriptions/plans` — Create/update plan (upsert)
- ✅ Admin UI: `app/admin/plans/page.tsx` — View plans (read-only)

**Admin UI Capabilities**:
- ✅ View all plans with details
- ✅ View plan features and limits
- ❌ **MISSING**: Edit plan form/modal
- ❌ **MISSING**: Create new plan form
- ❌ **MISSING**: Feature toggle UI
- ❌ **MISSING**: Limit editing UI

**Verdict**: **PARTIAL** — API exists, but UI is read-only. Full CRUD requires direct API calls.

---

#### ❌ **Admin UI / API for Managing Features**

**Answer**: **NO**

**Missing Capabilities**:
- ❌ No UI to toggle features per plan
- ❌ No UI to add/remove features from a plan
- ❌ No UI to view all available feature flags
- ❌ Must edit `subscription_plans.features` JSONB directly via SQL or API

**Verdict**: **NO** — Features must be managed via direct JSONB edits or API.

---

#### ❌ **Admin UI / API for Managing Limits**

**Answer**: **NO**

**Missing Capabilities**:
- ❌ No UI to edit limits per plan
- ❌ No UI to add new limit types
- ❌ Must edit `subscription_plans.features.limits` JSONB directly via SQL or API

**Verdict**: **NO** — Limits must be managed via direct JSONB edits or API.

---

#### ✅ **Admin UI / API for Managing Add-ons**

**Answer**: **UNKNOWN** (Not audited)

**Note**: WhatsApp addons exist (`whatsapp_addons` table), but admin UI/API was not audited.

---

### 6️⃣ WHAT IS NOT CONTROLLABLE TODAY

#### ❌ **Cannot control without code changes:**
1. Default plan ID (`'free'` hard-coded)
2. Report type → feature key mapping (hard-coded enum)
3. Limit type enums (`'invoices' | 'customers' | ...` hard-coded)
4. UI plan highlights (hard-coded marketing copy)
5. WhatsApp feature special handling (hard-coded: `featureKey === 'whatsapp_bot'`)

#### ❌ **Cannot control without SQL/API:**
1. Feature flags per plan (no UI)
2. Limits per plan (no UI)
3. Plan creation (no UI form)
4. Plan editing (no UI form)

#### ✅ **Can control via admin API (but no UI):**
1. Plan creation/update (`POST /api/admin/subscriptions/plans`)
2. Feature flags (via `features` JSONB in plan)
3. Limits (via `features.limits` JSONB in plan)

---

## 📋 FEATURE/LIMIT → HARD-CODED OR CONFIGURABLE TABLE

| Feature/Limit | Storage | Read Dynamically? | Admin UI? | Hard-Coded? | Verdict |
|---------------|---------|-------------------|-----------|-------------|---------|
| **Plan Definitions** | DB (`subscription_plans`) | ✅ YES | ⚠️ READ-ONLY | ❌ NO | ✅ **DATA-DRIVEN** |
| **Plan Features** | DB (`features.features` JSONB) | ✅ YES | ❌ NO | ❌ NO | ✅ **DATA-DRIVEN** |
| **Plan Limits** | DB (`features.limits` JSONB) | ✅ YES | ❌ NO | ❌ NO | ✅ **DATA-DRIVEN** |
| **Default Plan ID** | Code (`'free'`) | ❌ NO | ❌ NO | ✅ YES | ❌ **HARD-CODED** |
| **Report Type Mapping** | Code (enum) | ❌ NO | ❌ NO | ✅ YES | ⚠️ **HARD-CODED** |
| **Limit Types** | Code (enum) | ❌ NO | ❌ NO | ✅ YES | ⚠️ **HARD-CODED** |
| **UI Highlights** | Code (object) | ❌ NO | ❌ NO | ✅ YES | ⚠️ **UI-ONLY** |
| **WhatsApp Feature Check** | Code (`if featureKey === ...`) | ❌ NO | ❌ NO | ✅ YES | ⚠️ **HARD-CODED** |

---

## 🎯 RISK ASSESSMENT FOR PLATFORM FLEXIBILITY

### ✅ **LOW RISK** (Well-designed, data-driven)
1. **Plan Management**: Plans can be added/modified via admin API without code changes
2. **Feature Toggles**: Features can be enabled/disabled per plan without redeploy
3. **Limit Changes**: Limits can be changed per plan without redeploy
4. **Enforcement**: All enforcement reads from database dynamically

### ⚠️ **MEDIUM RISK** (Acceptable but could be improved)
1. **Default Plan Logic**: Hard-coded `'free'` plan ID reduces flexibility
2. **Report Type Mapping**: Hard-coded enum limits report type extensibility
3. **Limit Type Enums**: New limit types require code changes

### ❌ **HIGH RISK** (Missing admin capabilities)
1. **No Admin UI**: Features and limits must be edited via SQL or API
2. **No Feature Management UI**: Cannot toggle features per plan via UI
3. **No Limit Management UI**: Cannot edit limits per plan via UI
4. **JSONB Complexity**: Direct JSONB edits are error-prone

---

## 💡 RECOMMENDATIONS

### 🔴 **MUST BE MOVED TO DB** (Critical for flexibility)

1. **Default Plan ID** (`lib/subscription.ts` lines 122, 132, 134)
   - **Current**: Hard-coded `'free'`
   - **Fix**: Query for plan with `sort_order = 1` OR store in config table
   - **Impact**: Allows renaming/restructuring default plan

2. **Report Type → Feature Key Mapping** (`lib/subscription/feature-access.ts` lines 206-210)
   - **Current**: Hard-coded enum
   - **Fix**: Store in `feature_flags` table with metadata OR use naming convention
   - **Impact**: Allows new report types without code changes

### 🟡 **SHOULD BE MOVED TO DB** (Improves flexibility)

3. **UI Plan Highlights** (`app/page.tsx` lines 48-84)
   - **Current**: Hard-coded marketing copy
   - **Fix**: Generate dynamically from `plan.features.limits` OR store in `subscription_plans.highlights` JSONB
   - **Impact**: UI reflects actual DB limits

4. **WhatsApp Feature Special Handling** (`lib/subscription/feature-access.ts` lines 94-104)
   - **Current**: Hard-coded `if (featureKey === 'whatsapp_bot' || ...)`
   - **Fix**: Store feature metadata in `feature_flags` table (e.g., `check_type: 'addon'`)
   - **Impact**: Allows addon-based features to be configured via DB

### 🟢 **SAFE TO REMAIN IN CODE** (Acceptable)

5. **Limit Type Enums** (`lib/subscription.ts` line 114)
   - **Current**: TypeScript enum `'invoices' | 'customers' | ...`
   - **Reason**: Type safety is valuable, and limit types are stable
   - **Future**: Can be made dynamic if needed, but low priority

6. **Feature Key Strings in Enforcement**
   - **Current**: Feature keys like `'recurring_invoices'` are string literals in API routes
   - **Reason**: These are stable identifiers, and enforcement reads from DB
   - **Future**: No change needed

---

## 📝 ADMIN UI RECOMMENDATIONS

### ❌ **MISSING** (Should be built)

1. **Plan Editor UI** (`app/admin/plans/page.tsx`)
   - ✅ View plans (exists)
   - ❌ Edit plan form (missing)
   - ❌ Create plan form (missing)
   - ❌ Delete/deactivate plan (missing)

2. **Feature Management UI**
   - ❌ Toggle features per plan (missing)
   - ❌ View all available features (missing)
   - ❌ Add/remove features from plan (missing)

3. **Limit Management UI**
   - ❌ Edit limits per plan (missing)
   - ❌ View limit usage (missing)
   - ❌ Add new limit types (missing)

4. **Plan Comparison UI**
   - ❌ Side-by-side plan comparison (missing)
   - ❌ Feature diff view (missing)

---

## ✅ FINAL VERDICT

### **Platform Flexibility Score: 7/10**

**Strengths**:
- ✅ Core subscription logic is data-driven
- ✅ Plans, features, and limits stored in database
- ✅ Enforcement reads dynamically (no hard-coded plan checks)
- ✅ Can add/modify plans without code changes (mostly)
- ✅ Admin API exists for plan CRUD

**Weaknesses**:
- ❌ Default plan ID hard-coded
- ❌ Report type mapping hard-coded
- ❌ No admin UI for feature/limit management
- ❌ JSONB editing is error-prone without UI

**Recommendation**: 
- **SHORT TERM**: Fix default plan ID logic (move to config/DB query)
- **MEDIUM TERM**: Build admin UI for plan/feature/limit management
- **LONG TERM**: Make report type mapping and limit types fully dynamic

---

**Audit Complete** ✅  
**Status**: Ready for implementation recommendations


