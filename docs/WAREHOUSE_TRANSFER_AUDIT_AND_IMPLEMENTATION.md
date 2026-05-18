# Warehouse Stock Transfer - Complete Audit & Implementation

## PHASE 1 — AUDIT EXISTING INVENTORY SYSTEM

### 1. Inventory Data Model

#### ✅ IMPLEMENTED
- **Stock Storage**: `location_stock` table stores stock per warehouse
  - `location_id` → references `warehouses(id)` (after migration 119)
  - `item_id` → references `items(id)`
  - `current_stock_qty` → DECIMAL(15, 3)
  - `min_stock_qty` → DECIMAL(15, 3)
  - UNIQUE constraint on `(location_id, item_id)`

- **Stock Movements**: `stock_movements` table tracks all inventory changes
  - `type`: 'in', 'out', 'adjustment'
  - `reference_type`: 'purchase', 'sale', 'return', 'adjustment', 'stock_transfer'
  - `reference_id`: UUID of the source document
  - `location_id`: Warehouse ID (optional, for warehouse-specific tracking)
  - `batch_id`, `serial_id`: For batch/serial tracking
  - `unit_cost`: Cost snapshot

- **Cost Tracking**: 
  - FIFO/LIFO/Weighted Average supported via `lib/stock-valuation.ts`
  - `item_batches` table for batch-level cost tracking
  - `item_serials` table for serial-level cost tracking

#### ⚠️ PARTIALLY IMPLEMENTED
- **Stock Updates**: 
  - Uses `location_stock` for warehouse-specific stock
  - Falls back to `items.current_stock` if no `location_id` provided
  - Row-level locking (`FOR UPDATE`) used in some places

#### ❌ NOT IMPLEMENTED
- **Transfer-Specific Cost Tracking**: No cost snapshot in `stock_transfer_items`

### 2. Current Stock Update Flow

#### ✅ IMPLEMENTED
- **Stock Reduction (Invoice Finalize)**:
  - Location: `app/api/invoices/[id]/finalize/route.ts`
  - Uses `FOR UPDATE` lock on `location_stock`
  - Updates `location_stock.current_stock_qty` (decreases)
  - Records `stock_movements` with `type='out'`, `reference_type='invoice'`
  - Handles batch/serial allocation

- **Stock Increase (Purchase Finalize)**:
  - Location: `app/api/purchases/[id]/finalize/route.ts`
  - Uses `FOR UPDATE` lock on `location_stock`
  - Uses `INSERT ... ON CONFLICT DO UPDATE` to add stock
  - Records `stock_movements` with `type='in'`, `reference_type='purchase'`
  - Handles batch/serial creation

#### ⚠️ ISSUES FOUND
- **Stock Transfer CREATE**: 
  - Location: `app/api/stock-transfers/route.ts` (line 240-255)
  - **PROBLEM**: Stock is deducted immediately on CREATE
  - **SHOULD BE**: Stock deducted only on DISPATCH
  - This breaks the draft → dispatch → receive flow

- **Stock Transfer Status Flow**:
  - Current: `pending` → `in_transit` → `completed`
  - **MISSING**: `draft` and `pending_approval` statuses
  - **MISSING**: Approval workflow

### 3. Permissions

#### ✅ IMPLEMENTED
- **RBAC Module**: `warehouse_transfer` exists in `permission_modules`
- **PBAC Policies**: `lib/policies/resources/warehouse-transfers.ts` exists
  - Policies for: read, create, dispatch, receive, cancel
  - Uses `items.*` permissions (should use `warehouse_transfer.*`)

#### ⚠️ PARTIALLY IMPLEMENTED
- **RBAC Permissions**: 
  - Uses `items.read`, `items.create`, `items.update`, `items.delete`
  - **SHOULD USE**: `warehouse_transfer.view`, `warehouse_transfer.create`, `warehouse_transfer.dispatch`, `warehouse_transfer.receive`, `warehouse_transfer.approve`

- **PBAC Enforcement**:
  - Checks source/destination warehouse access
  - Validates status transitions
  - **MISSING**: Approval permission check

#### ❌ NOT IMPLEMENTED
- **Approval Workflow**: No approval step in transfer flow
- **Dedicated Transfer Permissions**: Using items permissions instead

---

## PHASE 2 — DATA MODEL FOR TRANSFERS

### Current Schema Issues

1. **`stock_transfers` table**:
   - ✅ Exists and references `warehouses(id)` (after migration 119)
   - ❌ Missing: `approved_by`, `approved_at` columns
   - ❌ Status values: Missing `draft` and `pending_approval`
   - ⚠️ Column names: Uses `from_location_id`/`to_location_id` (should be `from_warehouse_id`/`to_warehouse_id` for clarity, but migration 119 renamed them)

2. **`stock_transfer_items` table**:
   - ✅ Exists with `qty`, `received_qty`
   - ❌ Missing: `quantity_requested`, `quantity_dispatched` (separate tracking)
   - ❌ Missing: `cost_snapshot` (for cost tracking)

### Required Schema Changes

1. Add approval columns to `stock_transfers`
2. Add quantity tracking columns to `stock_transfer_items`
3. Add cost snapshot to `stock_transfer_items`
4. Update status enum to include `draft` and `pending_approval`

---

## PHASE 3 — TRANSFER FLOW (BUSINESS LOGIC)

### Current Flow (BROKEN)
1. CREATE → Immediately deducts stock ❌
2. DISPATCH → Changes status only (stock already deducted) ❌
3. RECEIVE → Adds stock to destination ✅

### Required Flow (CORRECT)
1. CREATE (Draft) → No stock movement ✅
2. APPROVE (Optional) → Status → `pending_approval` → `approved` ✅
3. DISPATCH → Deduct stock from source, status → `in_transit` ✅
4. RECEIVE → Add stock to destination, status → `completed` ✅
5. CANCEL → Restore stock if dispatched, status → `cancelled` ✅

---

## PHASE 4 — PERMISSIONS (RBAC + PBAC)

### Current State
- RBAC: Uses `items.*` permissions
- PBAC: Policies exist but need approval check

### Required Changes
1. Add `warehouse_transfer.*` permissions to RBAC
2. Update PBAC policies to use transfer permissions
3. Add approval permission check

---

## PHASE 5 — ACCOUNTING & TAX

### Current State
- ✅ No sales/purchase ledger entries for transfers
- ⚠️ Inter-branch transfers create invoices (for GST compliance)
- ✅ No GST calculations for same-business transfers

### Required
- ✅ Ensure no financial entries for internal transfers
- ✅ Keep inter-branch invoice logic (already exists)

---

## PHASE 6 — SAFETY & EDGE CASES

### Current Issues
1. ❌ Stock deducted on CREATE (should be on DISPATCH)
2. ❌ No approval workflow
3. ⚠️ Partial receipt supported but not fully tested
4. ✅ Row-level locking exists
5. ✅ Status validation exists in PBAC

### Required Fixes
1. Fix CREATE to not deduct stock
2. Add approval workflow
3. Ensure partial receipt works correctly
4. Add validation: cannot receive more than dispatched

---

## PHASE 7 — API & UI INTEGRATION

### Current APIs
- ✅ `GET /api/stock-transfers`
- ⚠️ `POST /api/stock-transfers` (deducts stock immediately - WRONG)
- ✅ `PATCH /api/stock-transfers/[id]/dispatch`
- ✅ `POST /api/stock-transfers/[id]/receive`
- ✅ `PATCH /api/stock-transfers/[id]/cancel`
- ❌ Missing: `POST /api/stock-transfers/[id]/approve`

### Required Changes
1. Fix CREATE to not deduct stock
2. Add APPROVE endpoint
3. Fix DISPATCH to deduct stock
4. Update UI to show approval step
5. Add sidebar menu item

---

## IMPLEMENTATION PLAN

### Step 1: Database Migration
- Add approval columns
- Add quantity tracking columns
- Add cost snapshot
- Update status enum

### Step 2: RBAC Permissions
- Add `warehouse_transfer.*` permissions
- Update default roles

### Step 3: PBAC Policies
- Update to use transfer permissions
- Add approval check

### Step 4: API Fixes
- Fix CREATE endpoint
- Add APPROVE endpoint
- Fix DISPATCH endpoint
- Update RECEIVE endpoint

### Step 5: UI Integration
- Add sidebar menu
- Create transfer list page
- Create transfer form
- Add approval UI

---

## FINAL VERDICT

**Current State**: ⚠️ PARTIALLY IMPLEMENTED
- Infrastructure exists but flow is broken
- Stock deducted on CREATE instead of DISPATCH
- No approval workflow
- Using wrong permissions

**After Fix**: ✅ PRODUCTION-SAFE
- Proper status flow
- Approval workflow
- Correct stock movement timing
- Proper RBAC + PBAC enforcement
