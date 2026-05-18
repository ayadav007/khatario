# Canonical Feature Key Registry Strategy

## Objective

Create a **SINGLE, CANONICAL source of truth** for feature keys to permanently eliminate feature-key mismatches across:
- Feature Matrix (JSONB / Registry)
- Sidebar configuration
- Route-to-feature mapping
- Backend feature checks

## Problem Statement

### Current Issues

1. **Multiple Naming Conventions:**
   - JSONB uses: `purchase_management`, `supplier_management`, `expense_tracking`
   - Sidebar uses: `purchase_suppliers`, `purchase_expenses`, `sales_estimates`
   - Route mapping uses: `purchase_management`, `sales_credit_notes`
   - Backend checks use: Mixed (some canonical, some legacy)

2. **Sidebar Lock Mismatches:**
   - Sidebar checks `purchase_suppliers` → Maps to `supplier_management` → But JSONB may not have it
   - Route `/purchases` → Maps to `purchase_management` → But sidebar uses different key
   - Result: Feature appears locked in sidebar even when enabled in Feature Matrix

3. **No Single Source of Truth:**
   - Feature keys defined in multiple places
   - Changes require updates across multiple files
   - Easy to introduce inconsistencies

## Solution: Canonical Feature Registry

### Architecture

```
┌─────────────────────────────────────────┐
│   lib/featureKeys.ts                    │
│   (CANONICAL REGISTRY)                  │
│   - All feature keys defined once       │
│   - Grouped by domain                   │
│   - Legacy mappings included            │
└─────────────────────────────────────────┘
                    │
                    │ normalizeFeatureKey()
                    │
        ┌───────────┴───────────┐
        │                       │
┌───────▼────────┐    ┌─────────▼──────────┐
│ lib/subscription│    │ components/Sidebar│
│ hasFeature()    │    │ hasFeature()      │
│ requireFeature()│    │ isRouteLocked()   │
└────────────────┘    └───────────────────┘
```

### Key Components

#### 1. Canonical Registry (`lib/featureKeys.ts`)

**Structure:**
- Feature keys grouped by domain (Sales, Purchase, Reports, etc.)
- Each key defined as a constant
- Type-safe with TypeScript

**Example:**
```typescript
export const SalesFeatures = {
  INVOICE_CREATION: 'invoice_creation',
  CUSTOMER_MANAGEMENT: 'customer_management',
  ESTIMATES_QUOTATIONS: 'estimates_quotations',
  // ...
} as const;
```

#### 2. Legacy Key Mapping

**Purpose:** Backward compatibility with existing subscriptions and code

**Implementation:**
```typescript
export const LegacyFeatureKeyMap: Record<string, FeatureKey> = {
  'sales_invoices': SalesFeatures.INVOICE_CREATION,
  'purchase_suppliers': PurchaseFeatures.SUPPLIER_MANAGEMENT,
  'settings_multi_user': SettingsFeatures.MULTI_USER,
  // ...
};
```

#### 3. Normalization Function

**Function:** `normalizeFeatureKey(key: string): FeatureKey`

**Behavior:**
- If key is canonical → return as-is
- If key is legacy → return canonical equivalent
- If key not found → return as-is (graceful degradation)

**Usage:**
```typescript
const canonicalKey = normalizeFeatureKey('sales_invoices');
// Returns: 'invoice_creation'
```

### How It Prevents Sidebar Lock Mismatches

#### Before (Problematic Flow)

```
Sidebar Item: "Purchases"
  ↓
Checks: hasFeature('purchase_management')
  ↓
Legacy Mapping: 'purchase_management' → 'purchase_management' (no change)
  ↓
JSONB Check: subscription.features.features['purchase_management']
  ↓
Result: ✅ Works (if JSONB has 'purchase_management')

BUT:

Sidebar Item: "Suppliers"
  ↓
Checks: hasFeature('purchase_suppliers')
  ↓
Legacy Mapping: 'purchase_suppliers' → 'supplier_management'
  ↓
JSONB Check: subscription.features.features['supplier_management']
  ↓
Result: ❌ Mismatch if JSONB has 'purchase_suppliers' but not 'supplier_management'
```

#### After (Fixed Flow)

```
Sidebar Item: "Suppliers"
  ↓
Checks: hasFeature('purchase_suppliers')
  ↓
Normalization: normalizeFeatureKey('purchase_suppliers') → 'supplier_management'
  ↓
JSONB Check (canonical): subscription.features.features['supplier_management']
  ↓
JSONB Check (legacy fallback): subscription.features.features['purchase_suppliers']
  ↓
Result: ✅ Works with EITHER key (backward compatible)
```

**Key Improvement:**
- Normalization ensures canonical key is checked first
- Legacy key is checked as fallback
- Both JSONB formats work (old and new)

## Implementation Details

### Files Updated

1. **`lib/featureKeys.ts`** (NEW)
   - Canonical feature registry
   - Legacy key mappings
   - Normalization function

2. **`lib/subscription.ts`** (UPDATED)
   - `hasFeature()` now normalizes keys
   - Checks both canonical and legacy keys
   - Backward compatible

3. **`components/layout/Sidebar.tsx`** (UPDATED)
   - `hasFeature()` uses normalization
   - Imports canonical keys
   - Maintains backward compatibility

### Backward Compatibility Strategy

#### Phase 1: Current (Incremental)
- ✅ Canonical registry created
- ✅ Normalization function added
- ✅ Both canonical and legacy keys checked
- ✅ No database migration required
- ✅ Existing subscriptions continue to work

#### Phase 2: Future (Migration)
- Migrate JSONB to use canonical keys only
- Update all code to use canonical keys
- Remove legacy mappings (optional)

### Feature Key Domains

| Domain | Canonical Keys | Legacy Aliases |
|--------|---------------|----------------|
| **Sales** | `invoice_creation`, `customer_management`, `estimates_quotations`, `credit_notes`, `recurring_invoices` | `sales_invoices`, `sales_estimates`, `sales_credit_notes`, `sales_recurring_invoices` |
| **Purchase** | `purchase_management`, `supplier_management`, `expense_tracking` | `purchase_suppliers`, `purchase_expenses` |
| **Reports** | `reports_basic`, `reports_gst`, `reports_advanced`, `reports_analytics` | None |
| **Settings** | `multi_user`, `multi_branch`, `backup_restore` | `settings_multi_user`, `settings_multi_branch`, `settings_backup` |
| **Integration** | `whatsapp_bot`, `whatsapp_manual`, `whatsapp_auto_reminders` | `integration_whatsapp_bot`, `integration_whatsapp_manual` |
| **Tools** | `todo` | `tools_todo` |

## Usage Examples

### Using Canonical Keys (Recommended)

```typescript
import { FeatureKeys } from '@/lib/featureKeys';

// In component
const hasAccess = hasFeature(FeatureKeys.PURCHASE_MANAGEMENT);

// In API route
await requireFeature(businessId, FeatureKeys.SUPPLIER_MANAGEMENT);
```

### Using Legacy Keys (Still Works)

```typescript
// Legacy keys still work via normalization
const hasAccess = hasFeature('purchase_suppliers');
// Automatically normalized to 'supplier_management'
```

### Normalization in Custom Code

```typescript
import { normalizeFeatureKey } from '@/lib/featureKeys';

const userInput = 'sales_invoices';
const canonicalKey = normalizeFeatureKey(userInput);
// Returns: 'invoice_creation'
```

## Benefits

### 1. Single Source of Truth
- All feature keys defined in one place
- Changes propagate automatically
- No more scattered definitions

### 2. Type Safety
- TypeScript ensures correct key usage
- IDE autocomplete for feature keys
- Compile-time error checking

### 3. Backward Compatibility
- Legacy keys still work
- No breaking changes
- Gradual migration possible

### 4. Prevents Mismatches
- Normalization ensures consistent checks
- Both canonical and legacy keys checked
- Sidebar locks match Feature Matrix

### 5. Maintainability
- Clear domain grouping
- Easy to add new features
- Documentation in code

## Migration Path

### Step 1: Use Canonical Keys in New Code ✅
- All new code should use `FeatureKeys.*` constants
- Legacy keys still work via normalization

### Step 2: Update Existing Code (Incremental)
- Update Sidebar to use canonical keys
- Update API routes to use canonical keys
- Update route mappings to use canonical keys

### Step 3: Database Migration (Future)
- Migrate JSONB to canonical keys only
- Update seed files
- Remove legacy key support (optional)

## Testing

### Test Cases

1. **Canonical Key Check:**
   ```typescript
   hasFeature('invoice_creation') // Should work
   ```

2. **Legacy Key Check:**
   ```typescript
   hasFeature('sales_invoices') // Should normalize and work
   ```

3. **Sidebar Lock:**
   - Feature enabled in JSONB with canonical key → Should be unlocked
   - Feature enabled in JSONB with legacy key → Should be unlocked
   - Feature disabled → Should be locked

4. **Route Protection:**
   - Route mapped to canonical key → Should check correctly
   - Route mapped to legacy key → Should normalize and check correctly

## Summary

The canonical feature registry:
- ✅ Eliminates feature key mismatches
- ✅ Provides single source of truth
- ✅ Maintains backward compatibility
- ✅ Prevents sidebar lock inconsistencies
- ✅ Enables type-safe feature checks
- ✅ Requires no database migration
- ✅ Allows incremental adoption

**Result:** Sidebar locks now correctly reflect Feature Matrix state, regardless of whether JSONB uses canonical or legacy keys.
