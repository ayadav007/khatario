# COMPREHENSIVE BRANCH & WAREHOUSE AUDIT
**Date**: 2024-12-19  
**Scope**: Multi-branch, multi-warehouse system integrity  
**Method**: Code path tracing, schema verification, API endpoint analysis

---

## EXECUTIVE SUMMARY

### 🚨 CRITICAL FINDINGS

**SYSTEM STATUS: ⚠️ PARTIALLY SAFE - REQUIRES FIXES**

The system has **foundational infrastructure** for branch/warehouse control, but contains **critical silent fallbacks** and **missing enforcement** that could lead to:
- Stock corruption (wrong warehouse stock updated)
- Data leakage (users seeing unauthorized transactions)
- Audit trail gaps (missing warehouse context)

### Risk Level Breakdown
- **🔴 HIGH RISK**: 5 issues
- **🟡 MEDIUM RISK**: 8 issues  
- **🟢 LOW RISK**: 3 issues

---

## PHASE 1: DATA MODEL & RELATIONSHIP AUDIT

### ✅ SAFE: Schema Structure

| Table | `branch_id` | `warehouse_id`/`location_id` | Status |
|-------|-------------|------------------------------|--------|
| `invoices` | ✅ EXISTS (migration 121) | N/A | ✅ SAFE |
| `purchases` | ✅ EXISTS (migration 121) | N/A | ✅ SAFE |
| `invoice_items` | N/A | ✅ EXISTS (migration 120, references `warehouses`) | ✅ SAFE |
| `purchase_items` | ❌ MISSING | ❌ MISSING | 🔴 **BROKEN** |
| `stock_movements` | N/A | ✅ EXISTS (migration 120, references `warehouses`) | ✅ SAFE |
| `inventory_adjustments` | N/A | ✅ EXISTS (migration 120, references `warehouses`) | ✅ SAFE |
| `location_stock` | N/A | ✅ EXISTS (references `warehouses.id` via `location_id`) | ✅ SAFE |

### 🔴 CRITICAL ISSUE #1: Missing `purchase_items.location_id`

**Problem**: `purchase_items` table has NO `location_id` column.

**Impact**:
- Cannot track which warehouse received stock on purchase
- Stock updates fall back to `items.current_stock` (global)
- Breaks warehouse-level stock tracking for purchases

**Evidence**:
```sql
-- No migration found that adds location_id to purchase_items
-- Code in app/api/purchases/route.ts uses item.location_id but column doesn't exist
```

**Files Affected**:
- `app/api/purchases/route.ts` (lines 605, 614, 685, 721)
- `app/api/purchases/[id]/finalize/route.ts` (lines 146, 250)

**Fix Required**: Migration to add `location_id UUID REFERENCES warehouses(id)` to `purchase_items`.

---

### 🔴 CRITICAL ISSUE #2: Silent Fallback to `items.current_stock`

**Problem**: When `location_id` is NULL, code silently falls back to updating `items.current_stock` instead of failing.

**Impact**:
- Stock can be updated without warehouse context
- Breaks warehouse-level inventory tracking
- Creates audit trail gaps

**Evidence**:

#### A. Purchase Creation (app/api/purchases/route.ts:613-644)
```typescript
// Update stock - use location_stock if location_id provided, otherwise global stock
const locationId = item.location_id || null;
if (locationId) {
  // Update location_stock
} else {
  // Fallback to global stock if no location
  await client.query(`
    UPDATE items 
    SET current_stock = current_stock + $1,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = $2
  `, [quantity, effectiveItemId]);
}
```

#### B. Purchase Finalize (app/api/purchases/[id]/finalize/route.ts:270-278)
```typescript
if (locationId) {
  // Update location_stock
} else {
  // Fallback to global stock if no location
  await client.query(`
    UPDATE items 
    SET current_stock = current_stock + $1,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = $2
  `, [quantity, row.item_id]);
}
```

#### C. Invoice Finalize (app/api/invoices/[id]/finalize/route.ts:314-322)
```typescript
if (locationId) {
  // Update location_stock
} else {
  // Fallback to global stock if no location
  await client.query(`
    UPDATE items 
    SET current_stock = current_stock - $1,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = $2
  `, [quantity, row.item_id]);
}
```

**Fix Required**: 
1. Make `location_id` MANDATORY for all stock-affecting operations
2. Remove fallback logic
3. Return 400 error if `location_id` is missing

---

### 🔴 CRITICAL ISSUE #3: Inventory Adjustments Use Global Stock

**Problem**: `lib/inventory-adjustment-service.ts` updates `items.current_stock` directly, ignoring warehouse context.

**Evidence** (lib/inventory-adjustment-service.ts:142-166):
```typescript
// Updates items.current_stock directly
const updateResult = await client.query(
  `UPDATE items 
   SET current_stock = $1, updated_at = CURRENT_TIMESTAMP 
   WHERE id = $2
   RETURNING id, current_stock`,
  [newQuantityDecimal, params.itemId]
);

// Only updates location_stock if locationId provided (optional)
if (params.locationId) {
  await client.query(
    `INSERT INTO location_stock (location_id, item_id, current_stock_qty, last_updated)
     VALUES ($1, $2, $3, CURRENT_TIMESTAMP)
     ON CONFLICT (location_id, item_id) 
     DO UPDATE SET 
       current_stock_qty = location_stock.current_stock_qty + $3,
       last_updated = CURRENT_TIMESTAMP`,
    [params.locationId, params.itemId, quantityChange]
  );
}
```

**Impact**:
- Adjustments can occur without warehouse context
- Global stock updated even when warehouse specified
- Creates inconsistency between `items.current_stock` and `location_stock`

**Fix Required**:
1. Make `locationId` MANDATORY for inventory adjustments
2. Update ONLY `location_stock`, never `items.current_stock`
3. Remove global stock update logic

---

### 🔴 CRITICAL ISSUE #4: WhatsApp CRM Bypasses Warehouse System

**Problem**: `lib/whatsapp-crm.ts` creates invoices using `items.current_stock` directly, completely bypassing warehouse system.

**Evidence** (lib/whatsapp-crm.ts:794-805):
```typescript
if (itemType === 'goods') {
  await client.query(
    `UPDATE items SET current_stock = current_stock - $1, updated_at = CURRENT_TIMESTAMP 
     WHERE id = $2`,
    [itemData.quantity, itemData.id]
  );

  // Record stock movement WITHOUT location_id
  await client.query(
    `INSERT INTO stock_movements (business_id, item_id, type, quantity, reference_type, reference_id, notes)
     VALUES ($1, $2, 'out', $3, 'invoice', $4, $5)`,
    [businessId, itemData.id, itemData.quantity, invoice.id, `Invoice ${invoiceNumber}`]
  );
}
```

**Impact**:
- WhatsApp-created invoices bypass warehouse control
- No warehouse context in stock movements
- Breaks audit trail

**Fix Required**:
1. Require warehouse selection in WhatsApp flow
2. Update `location_stock` instead of `items.current_stock`
3. Include `location_id` in stock movements

---

### 🔴 CRITICAL ISSUE #5: Stock Movements Missing `location_id`

**Problem**: Many stock movement inserts do NOT include `location_id`, even when warehouse is known.

**Evidence**:
- `lib/inventory-adjustment-service.ts:218-234` - Stock movement created WITHOUT `location_id`
- `lib/whatsapp-crm.ts:801-805` - Stock movement created WITHOUT `location_id`
- Multiple places in invoice/purchase finalize routes

**Impact**:
- Historical stock movements lack warehouse context
- Cannot reconstruct warehouse-level stock history
- Breaks reporting and auditability

**Fix Required**: Ensure ALL stock movement inserts include `location_id` when warehouse is known.

---

## PHASE 2: TRANSACTION FLOW AUDIT

### A. Inventory Adjustment

| Aspect | Status | Details |
|--------|--------|---------|
| Warehouse Selection | ⚠️ OPTIONAL | `location_id` is optional in API |
| Branch Inference | ❌ MISSING | No branch_id in inventory_adjustments table |
| PBAC Enforcement | ⚠️ PARTIAL | Checks `items.create` permission, but NOT warehouse access |
| Stock Movement | 🔴 BROKEN | Updates `items.current_stock` + optional `location_stock` |
| Can occur without warehouse? | ✅ YES | Silent fallback to global stock |

**Files**: `app/api/inventory-adjustments/route.ts`, `lib/inventory-adjustment-service.ts`

**Issues**:
1. ❌ No warehouse access check (PBAC)
2. ❌ Updates global stock even when warehouse specified
3. ❌ Stock movement missing `location_id`

---

### B. Purchase Creation & Finalization

| Aspect | Status | Details |
|--------|--------|---------|
| Warehouse Selection | ⚠️ OPTIONAL | `item.location_id` optional, falls back to global stock |
| Branch Linkage | ✅ SAFE | `purchases.branch_id` exists and is used |
| Stock Increment | 🔴 BROKEN | Falls back to `items.current_stock` if no warehouse |
| PBAC Enforcement | ⚠️ PARTIAL | Checks branch access, but NOT warehouse access |
| Can finalize without warehouse? | ✅ YES | Silent fallback |

**Files**: `app/api/purchases/route.ts`, `app/api/purchases/[id]/finalize/route.ts`

**Issues**:
1. ❌ `purchase_items.location_id` column MISSING
2. ❌ No warehouse access check (PBAC)
3. ❌ Silent fallback to global stock
4. ⚠️ Stock movement may be missing `location_id`

---

### C. Invoice Creation & Finalization

| Aspect | Status | Details |
|--------|--------|---------|
| Warehouse Selection | ⚠️ OPTIONAL | `item.location_id` optional, falls back to global stock |
| Branch Linkage | ✅ SAFE | `invoices.branch_id` exists and is used |
| Stock Deduction | 🔴 BROKEN | Falls back to `items.current_stock` if no warehouse |
| PBAC Enforcement | ⚠️ PARTIAL | Checks branch access, validates warehouse-branch link, but NOT warehouse access |
| Can finalize without warehouse? | ✅ YES | Silent fallback |

**Files**: `app/api/invoices/route.ts`, `app/api/invoices/[id]/finalize/route.ts`

**Issues**:
1. ❌ No warehouse access check (PBAC) - only validates warehouse-branch link
2. ❌ Silent fallback to global stock
3. ⚠️ Stock movement may be missing `location_id`

**Positive Finding**:
- ✅ Validates warehouse-branch relationship (line 150-163 in finalize route)

---

### D. Delivery Challan / Dispatch

**Status**: ⚠️ NOT AUDITED (no dedicated endpoint found)

**Assumption**: Uses invoice system, inherits same issues.

---

### E. Stock Transfer

| Aspect | Status | Details |
|--------|--------|---------|
| Source Warehouse | ✅ SAFE | `from_location_id` required |
| Destination Warehouse | ✅ SAFE | `to_location_id` required |
| Approval Flow | ✅ SAFE | Proper status transitions |
| Stock Movement | ✅ SAFE | Properly updates `location_stock` |
| PBAC Enforcement | ✅ SAFE | Checks warehouse access for both source and destination |

**Files**: `app/api/stock-transfers/route.ts`, `app/api/stock-transfers/[id]/dispatch/route.ts`, `app/api/stock-transfers/[id]/receive/route.ts`

**Verdict**: ✅ **SAFE** - This is the ONLY fully compliant flow.

---

### F. Returns (Sales & Purchase)

**Status**: ⚠️ NOT FULLY AUDITED

**Assumption**: Likely inherits issues from invoice/purchase systems.

---

## PHASE 3: ACCESS CONTROL AUDIT (RBAC + PBAC)

### RBAC Status

| Permission | Module | Status | Notes |
|------------|--------|--------|-------|
| `items.create` | items | ✅ SAFE | Used for inventory adjustments |
| `items.update` | items | ✅ SAFE | Used for item updates |
| `purchases.create` | purchases | ✅ SAFE | Used for purchase creation |
| `purchases.update` | purchases | ✅ SAFE | Used for purchase finalization |
| `invoices.create` | invoices | ✅ SAFE | Used for invoice creation |
| `invoices.finalize` | invoices | ✅ SAFE | Used for invoice finalization |
| `warehouse_transfer.*` | warehouse_transfer | ✅ SAFE | Properly enforced |

**Verdict**: ✅ RBAC is properly enforced.

---

### PBAC Status

| Operation | Branch Check | Warehouse Check | Status |
|-----------|--------------|-----------------|--------|
| Purchase Create | ✅ YES | ❌ NO | 🔴 MISSING |
| Purchase Finalize | ✅ YES | ❌ NO | 🔴 MISSING |
| Invoice Create | ✅ YES | ❌ NO | 🔴 MISSING |
| Invoice Finalize | ✅ YES | ⚠️ PARTIAL* | ⚠️ PARTIAL |
| Inventory Adjustment | ❌ NO | ❌ NO | 🔴 MISSING |
| Stock Transfer | ✅ YES | ✅ YES | ✅ SAFE |

*Invoice Finalize validates warehouse-branch link but does NOT check user warehouse access.

**Critical Gap**: Most operations check BRANCH access but NOT WAREHOUSE access.

**Fix Required**: Add warehouse access checks using `checkUserWarehouseAccess` or `authorize` with warehouse context.

---

## PHASE 4: EDGE CASE & SAFETY AUDIT

### 1. User has branch access but NO warehouse access

**Current Behavior**: 
- ✅ Can create invoices/purchases (branch check passes)
- ❌ Can select ANY warehouse in items (no warehouse check)
- ❌ Stock updates succeed even if user has no warehouse access

**Risk**: 🔴 **HIGH** - User can manipulate stock in warehouses they shouldn't access.

---

### 2. User has warehouse access but NO branch access

**Current Behavior**:
- ❌ Cannot create invoices/purchases (branch check fails)
- ✅ Can access warehouse directly (if separate endpoint exists)

**Risk**: 🟡 **MEDIUM** - May be intentional (branch = accounting, warehouse = inventory).

---

### 3. Warehouse linked to multiple branches

**Current Behavior**:
- ✅ Invoice finalize validates warehouse-branch link (line 150-163)
- ⚠️ Purchase finalize does NOT validate warehouse-branch link

**Risk**: 🟡 **MEDIUM** - Purchase can use warehouse from wrong branch.

---

### 4. Branch deleted but warehouse exists

**Current Behavior**:
- ✅ Foreign key constraint prevents branch deletion if transactions exist
- ⚠️ Warehouse can exist without branch link

**Risk**: 🟢 **LOW** - Handled by FK constraints.

---

### 5. Warehouse deleted but transactions exist

**Current Behavior**:
- ✅ Foreign key `ON DELETE SET NULL` allows deletion
- ⚠️ Historical transactions lose warehouse context

**Risk**: 🟡 **MEDIUM** - Audit trail broken for deleted warehouses.

---

### 6. Auto-assign OFF + legacy users

**Current Behavior**:
- ✅ Explicit warehouse access required
- ⚠️ Legacy users may have no explicit access

**Risk**: 🟡 **MEDIUM** - Legacy users may be locked out.

---

### 7. Concurrent transactions affecting same warehouse

**Current Behavior**:
- ✅ Uses `FOR UPDATE` locks in finalize routes
- ⚠️ Purchase creation does NOT lock warehouse stock

**Risk**: 🟡 **MEDIUM** - Race conditions possible during purchase creation.

---

## PHASE 5: REPORTING & VISIBILITY

### Stock Reports

| Report | Branch Filter | Warehouse Filter | User Access Check |
|--------|--------------|------------------|-------------------|
| Stock Summary | ✅ YES | ✅ YES | ⚠️ PARTIAL |
| Stock Valuation | ✅ YES | ✅ YES | ✅ YES |
| Stock Movement | ⚠️ UNKNOWN | ⚠️ UNKNOWN | ⚠️ UNKNOWN |

**Status**: ⚠️ **PARTIALLY SAFE** - Some reports check access, others may not.

---

### Transaction Reports

| Report | Branch Filter | Warehouse Filter | User Access Check |
|--------|--------------|------------------|-------------------|
| Invoice List | ✅ YES | ❌ NO | ✅ YES (via branch) |
| Purchase List | ✅ YES | ❌ NO | ✅ YES (via branch) |

**Status**: ⚠️ **PARTIALLY SAFE** - Branch filtering works, but warehouse filtering missing.

---

## PHASE 6: GAP ANALYSIS & FIX PLAN

### 🔴 HIGH PRIORITY FIXES

#### Fix #1: Add `location_id` to `purchase_items`
**File**: New migration  
**Action**: 
```sql
ALTER TABLE purchase_items 
  ADD COLUMN location_id UUID REFERENCES warehouses(id) ON DELETE SET NULL;
CREATE INDEX idx_purchase_items_location ON purchase_items(location_id);
```

**Impact**: Enables warehouse tracking for purchases.

---

#### Fix #2: Remove Silent Fallbacks to `items.current_stock`
**Files**: 
- `app/api/purchases/route.ts`
- `app/api/purchases/[id]/finalize/route.ts`
- `app/api/invoices/[id]/finalize/route.ts`

**Action**: 
1. Make `location_id` MANDATORY for all stock operations
2. Return 400 error if missing
3. Remove all fallback logic

**Impact**: Forces warehouse selection, prevents global stock updates.

---

#### Fix #3: Fix Inventory Adjustment Service
**File**: `lib/inventory-adjustment-service.ts`

**Action**:
1. Make `locationId` MANDATORY
2. Update ONLY `location_stock`, never `items.current_stock`
3. Include `location_id` in stock movements

**Impact**: Proper warehouse-level adjustments.

---

#### Fix #4: Add Warehouse Access Checks (PBAC)
**Files**: 
- `app/api/purchases/route.ts`
- `app/api/purchases/[id]/finalize/route.ts`
- `app/api/invoices/route.ts`
- `app/api/invoices/[id]/finalize/route.ts`
- `app/api/inventory-adjustments/route.ts`

**Action**:
```typescript
// Before stock update, check warehouse access
const warehouseAccess = await checkUserWarehouseAccess(userId, warehouseId);
if (!warehouseAccess?.can_create_transactions) {
  return NextResponse.json(
    { error: 'No access to warehouse' },
    { status: 403 }
  );
}
```

**Impact**: Prevents unauthorized warehouse access.

---

#### Fix #5: Fix WhatsApp CRM
**File**: `lib/whatsapp-crm.ts`

**Action**:
1. Require warehouse selection
2. Update `location_stock` instead of `items.current_stock`
3. Include `location_id` in stock movements

**Impact**: WhatsApp invoices respect warehouse system.

---

### 🟡 MEDIUM PRIORITY FIXES

#### Fix #6: Ensure All Stock Movements Include `location_id`
**Files**: All files that insert into `stock_movements`

**Action**: Audit and fix all stock movement inserts to include `location_id`.

---

#### Fix #7: Validate Warehouse-Branch Link in Purchases
**File**: `app/api/purchases/[id]/finalize/route.ts`

**Action**: Add same validation as invoice finalize (lines 150-163).

---

#### Fix #8: Add Warehouse Filtering to Reports
**Files**: Report endpoints

**Action**: Add warehouse filtering and access checks.

---

## FINAL VERDICT

### Is the system SAFE for multi-warehouse production usage?

**Answer**: ⚠️ **NO - NOT YET**

### Minimum Work Required

1. **Database Migration**: Add `location_id` to `purchase_items`
2. **Remove Silent Fallbacks**: Make warehouse MANDATORY for all stock operations
3. **Fix Inventory Adjustments**: Update only `location_stock`
4. **Add PBAC Checks**: Warehouse access validation in all stock operations
5. **Fix WhatsApp CRM**: Respect warehouse system

**Estimated Effort**: 2-3 days of focused development

### Risk Assessment

- **Data Corruption Risk**: 🔴 **HIGH** (silent fallbacks can corrupt stock)
- **Security Risk**: 🔴 **HIGH** (missing warehouse access checks)
- **Audit Trail Risk**: 🔴 **HIGH** (missing warehouse context in movements)

### Recommendation

**DO NOT deploy to production** until Fixes #1-#5 are completed.

---

## SUMMARY TABLE

| Feature | Branch Enforcement | Warehouse Enforcement | RBAC Enforced | PBAC Enforced | Status |
|---------|-------------------|----------------------|---------------|---------------|--------|
| Purchase Create | ✅ YES | ❌ NO | ✅ YES | ⚠️ PARTIAL | 🔴 BROKEN |
| Purchase Finalize | ✅ YES | ❌ NO | ✅ YES | ⚠️ PARTIAL | 🔴 BROKEN |
| Invoice Create | ✅ YES | ❌ NO | ✅ YES | ⚠️ PARTIAL | 🔴 BROKEN |
| Invoice Finalize | ✅ YES | ⚠️ PARTIAL* | ✅ YES | ⚠️ PARTIAL | 🔴 BROKEN |
| Inventory Adjustment | ❌ NO | ❌ NO | ✅ YES | ❌ NO | 🔴 BROKEN |
| Stock Transfer | ✅ YES | ✅ YES | ✅ YES | ✅ YES | ✅ SAFE |
| Returns | ⚠️ UNKNOWN | ⚠️ UNKNOWN | ⚠️ UNKNOWN | ⚠️ UNKNOWN | ⚠️ UNKNOWN |

*Validates warehouse-branch link but not user warehouse access.

---

**END OF AUDIT**
