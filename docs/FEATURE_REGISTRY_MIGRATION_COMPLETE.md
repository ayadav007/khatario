# Feature Registry Migration - Complete

## Overview

This document describes the **ONE-WAY migration** from JSONB-based feature flags to a database-backed Feature Registry system. This migration is **irreversible** and removes all JSONB fallbacks.

**Migration Date:** 2024  
**Migration Number:** 137  
**Status:** ✅ COMPLETE

---

## Migration Phases

### ✅ Phase 1: Data Migration

**File:** `database/migrations/137_migrate_jsonb_to_feature_registry.sql`

**What it does:**
- Reads all active subscription plans
- Extracts enabled features from `subscription_plans.features` JSONB
- Maps canonical JSONB keys to Feature Registry IDs
- Inserts rows into `subscription_plan_features` with `enabled = true`
- Validates that all plans have at least one enabled feature
- Reports unmapped keys (non-fatal, but should be reviewed)

**Key mappings:**
- `invoice_creation` → `sales_invoices`
- `estimates_quotations` → `sales_estimates`
- `credit_notes` → `sales_credit_notes`
- `recurring_invoices` → `sales_recurring_invoices`
- `sales_orders` → `sales_sales_orders`
- `supplier_management` → `purchase_suppliers`
- `expense_tracking` → `purchase_expenses`
- `template_customization` → `settings_template_customization`
- `multi_user` → `settings_multi_user`
- `multi_branch` → `settings_multi_branch`
- `multi_warehouse` → `settings_multi_warehouse`
- `backup_restore` → `settings_backup`
- `pos_mode` → `settings_pos_mode`
- And more...

**Core features** (always enabled, not in registry):
- `customer_management`
- `item_management`
- `payment_tracking`
- `stock_tracking`
- `template_basic`, `template_all`, `template_thermal`
- `pdf_generation`
- `dashboard_analytics`
- `reports_basic`, `reports_gst`, `reports_advanced`, `reports_analytics`
- `alert_low_stock`, `alert_credit_limit`
- Addon-based features (WhatsApp) - handled dynamically

---

### ✅ Phase 2: Registry Completeness Guarantee

**What it does:**
- Adds `registry_complete` column to `subscription_plans` table
- Marks all active plans as `registry_complete = true` after successful migration
- Creates indexes for performance

**Purpose:**
- Indicates that a plan has been fully migrated
- When `registry_complete = true`, JSONB features are **ignored**
- Enables hard fail safety (Phase 4)

---

### ✅ Phase 3: Code Enforcement Changes

**File:** `lib/subscription/feature-access.ts`

**Changes:**

1. **`getEnabledFeaturesFromRegistry()`:**
   - **BEFORE:** Returned `null` if registry empty → triggered JSONB fallback
   - **AFTER:** Always returns array (empty if no features)
   - Throws error if `registry_complete = true` and registry is empty
   - Logs warning if `registry_complete = false` and registry is empty

2. **`assertFeatureAccess()`:**
   - **BEFORE:** Checked Feature Registry, then fell back to JSONB
   - **AFTER:** Checks Feature Registry ONLY
   - Throws `FeatureAccessDeniedError` if feature not found
   - Hard fails if `registry_complete = true` and feature missing

3. **`getEnabledFeatures()`:**
   - **BEFORE:** Tried Feature Registry, then fell back to JSONB with key mapping
   - **AFTER:** Returns features from Feature Registry ONLY
   - Adds addon-based features dynamically (WhatsApp)

**Removed:**
- All JSONB feature reads
- All fallback logic
- All conditional checks based on empty arrays
- All canonical-to-registry key mapping in fallback path

---

### ✅ Phase 4: Hard Fail Safety

**What it does:**
- When `registry_complete = true`:
  - Missing features MUST fail fast
  - No silent unlocks
  - No legacy leakage
  - Explicit error messages

**Implementation:**
- `getEnabledFeaturesFromRegistry()` throws error if `registry_complete = true` and zero features
- `assertFeatureAccess()` throws `FeatureAccessDeniedError` if `registry_complete = true` and feature not found
- All errors include clear messages about registry completeness

---

### ✅ Phase 5: Cleanup

**Files updated:**
- `app/api/features/enabled/route.ts`: Removed JSONB fallback detection, always returns `source: 'registry'`
- `components/layout/Sidebar.tsx`: Updated comment to reflect registry-only approach

**Removed references:**
- JSONB fallback comments
- JSONB source detection logic
- Conditional source assignment

---

## Database Schema Changes

### New Column

```sql
ALTER TABLE subscription_plans 
ADD COLUMN registry_complete BOOLEAN DEFAULT false;
```

### New Indexes

```sql
CREATE INDEX idx_plan_features_plan_enabled 
ON subscription_plan_features(plan_id, enabled) 
WHERE enabled = true;

CREATE INDEX idx_subscription_plans_registry_complete 
ON subscription_plans(registry_complete) 
WHERE registry_complete = true;
```

---

## Migration Execution

### Prerequisites

1. Feature Registry tables must exist:
   - `platform_features`
   - `subscription_plan_features`

2. All platform features must be populated in `platform_features`

3. Backup database before running migration

### Running the Migration

```bash
# Run migration
psql -d your_database -f database/migrations/137_migrate_jsonb_to_feature_registry.sql
```

### Verification

The migration script includes automatic verification:
- Checks that all active plans have registry entries
- Fails if any plan has zero enabled features
- Reports unmapped keys (non-fatal)

---

## Post-Migration Checklist

- [x] Migration script executed successfully
- [x] All plans marked `registry_complete = true`
- [x] All active plans have registry entries
- [x] Code updated to remove JSONB fallbacks
- [x] API routes updated
- [x] Frontend components updated
- [x] Tests updated (if applicable)

---

## Breaking Changes

### For Developers

1. **NO JSONB fallbacks:** If Feature Registry is incomplete, features will fail
2. **Hard failures:** Missing features throw errors when `registry_complete = true`
3. **Registry mandatory:** Feature Registry must be populated before deployment

### For Platform Admins

1. **Feature Matrix:** Must use Feature Matrix UI to enable/disable features
2. **No JSONB editing:** Editing `subscription_plans.features` JSONB has no effect
3. **Migration required:** All plans must be migrated before enabling `registry_complete`

---

## Rollback Plan

**⚠️ WARNING:** This migration is **ONE-WAY**. Rollback requires:

1. Restore database from backup (before migration)
2. Revert code changes
3. Re-run previous version

**DO NOT** attempt to rollback by:
- Setting `registry_complete = false` (code will still use registry)
- Re-adding JSONB fallback code (defeats purpose of migration)

---

## Future Work

### Optional Cleanup (Future)

1. **Remove JSONB column:** After verification period, consider removing `features` JSONB column
2. **Documentation:** Update all documentation to reference Feature Registry only
3. **Monitoring:** Add alerts for registry completeness issues

### Not Recommended

- Re-adding JSONB fallbacks (defeats migration purpose)
- Dual-source feature checks (adds complexity)
- Conditional registry usage (defeats migration purpose)

---

## Support

If you encounter issues:

1. **Check registry completeness:**
   ```sql
   SELECT id, name, registry_complete 
   FROM subscription_plans 
   WHERE is_active = true;
   ```

2. **Check plan features:**
   ```sql
   SELECT plan_id, COUNT(*) as feature_count
   FROM subscription_plan_features
   WHERE enabled = true
   GROUP BY plan_id;
   ```

3. **Check platform features:**
   ```sql
   SELECT COUNT(*) FROM platform_features WHERE is_active = true;
   ```

---

## Summary

✅ **Migration Complete:** All JSONB fallbacks removed  
✅ **Registry Only:** Feature Registry is the single source of truth  
✅ **Hard Fail Safety:** Missing features fail fast when `registry_complete = true`  
✅ **No Rollback:** Migration is one-way and irreversible  

**Status:** Production Ready
