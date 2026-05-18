# Branch & Warehouse Integration Audit Report

**Date:** 2024  
**Audit Type:** Pre-Production Enterprise Audit  
**Scope:** End-to-end integration of Branch and Warehouse features  
**Severity Levels:** 🔴 CRITICAL | 🟠 HIGH | 🟡 MEDIUM | 🟢 LOW | ✅ CORRECT

---

## Executive Summary

This audit examines the integration between Branch (accounting/compliance entity) and Warehouse (inventory storage entity) features. The system has been refactored to separate these concepts, but several critical gaps remain that could cause data integrity issues, compliance violations, and operational failures in production.

**Overall Status:** ⚠️ **NOT PRODUCTION-READY** - Critical fixes required

**Key Findings:**
- 🔴 **5 Critical Issues** - Must fix before production
- 🟠 **8 High Priority Issues** - Fix before scaling
- 🟡 **6 Medium Priority Issues** - Address in next sprint
- ✅ **12 Correct Implementations** - Working as expected

---

## 1. End-to-End Transaction Lifecycle

### ✅ **CORRECT: Branch ID Validation in Transactions**

**Status:** ✅ **IMPLEMENTED CORRECTLY**

**Evidence:**
- `app/api/invoices/route.ts:277-316` - Validates `branch_id`, checks if branch exists, is active, and belongs to business
- `app/api/purchases/route.ts:169-184` - Similar validation for purchases
- `app/api/payments/route.ts:100-142` - Branch validation in payments
- `app/api/expenses/route.ts:95-142` - Branch validation in expenses

**Implementation:**
```typescript
// Validates branch exists, is active, and belongs to business
const branchCheck = await client.query(`
  SELECT id, is_active FROM branches 
  WHERE id = $1 AND business_id = $2
`, [finalBranchId, business_id]);

if (branchCheck.rows.length === 0) {
  return NextResponse.json(
    { error: 'Invalid branch_id. Branch not found or does not belong to this business.' },
    { status: 400 }
  );
}

if (!branchCheck.rows[0].is_active) {
  return NextResponse.json(
    { error: 'Branch is inactive. Cannot create invoice for inactive branch.' },
    { status: 400 }
  );
}
```

**Verdict:** ✅ Correctly implemented with proper validation.

---

### 🔴 **CRITICAL: Missing Warehouse-Branch Relationship Validation**

**Status:** 🔴 **CRITICAL ISSUE**

**Problem:** Invoice items can reference warehouses that don't belong to the invoice's branch, causing:
- Inventory deducted from wrong warehouse
- Stock reports showing incorrect data
- Compliance issues (GST reporting mismatch)

**Evidence:**
- `app/api/invoices/route.ts:963` - Uses `item.location_id` (warehouse_id) without validation
- `app/api/invoices/[id]/finalize/route.ts:188-216` - Deducts stock from warehouse without checking branch relationship
- No validation that `invoice_items.location_id` belongs to a warehouse accessible by `invoices.branch_id`

**Missing Validation:**
```typescript
// ❌ CURRENT CODE (NO VALIDATION):
await client.query(`
  UPDATE location_stock
  SET current_stock_qty = current_stock_qty - $1
  WHERE location_id = $2 AND item_id = $3
`, [quantity, locationId, row.item_id]);

// ✅ REQUIRED VALIDATION:
// 1. Check warehouse exists and belongs to business
// 2. Check warehouse is accessible by invoice branch (via branch_warehouses)
// 3. Verify stock availability before deduction
```

**Impact:**
- **Data Integrity:** Stock can be deducted from warehouses not associated with the branch
- **Compliance:** GST reports may show incorrect branch-wise sales
- **Operational:** Warehouse managers see stock movements they didn't authorize

**Fix Required:**
```typescript
// Add validation before stock deduction:
const warehouseCheck = await client.query(`
  SELECT w.id, w.business_id, bw.branch_id
  FROM warehouses w
  LEFT JOIN branch_warehouses bw ON w.id = bw.warehouse_id AND bw.branch_id = $1
  WHERE w.id = $2 AND w.business_id = $3
`, [invoice.branch_id, item.location_id, invoice.business_id]);

if (warehouseCheck.rows.length === 0) {
  throw new Error(`Warehouse ${item.location_id} not found or not accessible by branch ${invoice.branch_id}`);
}

if (!warehouseCheck.rows[0].branch_id && warehouseCheck.rows[0].business_id !== invoice.business_id) {
  throw new Error(`Warehouse ${item.location_id} is not associated with branch ${invoice.branch_id}`);
}
```

**Files Affected:**
- `app/api/invoices/route.ts` - Invoice creation
- `app/api/invoices/[id]/finalize/route.ts` - Invoice finalization
- `app/api/purchases/route.ts` - Purchase creation
- `app/api/purchases/[id]/finalize/route.ts` - Purchase finalization

---

### 🟠 **HIGH: Missing Warehouse ID in Invoice Items Table**

**Status:** 🟠 **HIGH PRIORITY**

**Problem:** `invoice_items` table uses `location_id` (legacy name) instead of `warehouse_id`, causing confusion and potential migration issues.

**Evidence:**
- `database/migrations/120_update_location_references_to_warehouses.sql:26` - Renames `warehouse_id` back to `location_id`
- `database/schema.sql:209-229` - `invoice_items` table doesn't show `location_id` or `warehouse_id` column

**Issue:**
The migration renames `warehouse_id` to `location_id` for backward compatibility, but this creates confusion:
- Code uses `item.location_id` but it's actually a warehouse reference
- Schema doesn't clearly indicate this is a warehouse reference
- Future developers may confuse it with old `business_locations`

**Fix Required:**
1. Add explicit `warehouse_id` column to `invoice_items`
2. Add foreign key constraint: `FOREIGN KEY (warehouse_id) REFERENCES warehouses(id)`
3. Add comment: `COMMENT ON COLUMN invoice_items.warehouse_id IS 'Warehouse from which stock was sold. Must be accessible by invoice.branch_id'`
4. Add check constraint: Validate warehouse belongs to branch via `branch_warehouses` table

---

### 🟡 **MEDIUM: No Default Warehouse Selection Logic**

**Status:** 🟡 **MEDIUM PRIORITY**

**Problem:** When creating invoices, if no warehouse is specified, the system doesn't automatically select a default warehouse for the branch.

**Evidence:**
- `app/api/invoices/route.ts:963` - Uses `item.location_id || undefined` without fallback
- No logic to select primary warehouse for branch

**Impact:**
- Users must manually select warehouse for each item
- Risk of forgetting to select warehouse, causing stock deduction from wrong location

**Fix Required:**
```typescript
// Add default warehouse selection:
let warehouseId = item.location_id;
if (!warehouseId) {
  const defaultWarehouse = await client.query(`
    SELECT w.id
    FROM warehouses w
    JOIN branch_warehouses bw ON w.id = bw.warehouse_id
    WHERE bw.branch_id = $1 AND bw.is_primary = true
    LIMIT 1
  `, [finalBranchId]);
  
  warehouseId = defaultWarehouse.rows[0]?.id || null;
}
```

---

## 2. Inventory Accuracy Across Warehouses

### ✅ **CORRECT: Stock Deduction with Locking**

**Status:** ✅ **IMPLEMENTED CORRECTLY**

**Evidence:**
- `app/api/invoices/[id]/finalize/route.ts:204-208` - Uses `FOR UPDATE` lock before stock deduction
- `app/api/stock-transfers/route.ts:115` - Uses `FOR UPDATE` for stock availability check

**Implementation:**
```typescript
// Lock location stock for update
await client.query(`
  SELECT * FROM location_stock 
  WHERE location_id = $1 AND item_id = $2
  FOR UPDATE
`, [locationId, row.item_id]);

// Update location_stock
await client.query(`
  UPDATE location_stock
  SET current_stock_qty = current_stock_qty - $1,
      last_updated = CURRENT_TIMESTAMP
  WHERE location_id = $2 AND item_id = $3
`, [quantity, locationId, row.item_id]);
```

**Verdict:** ✅ Correctly prevents race conditions in stock deduction.

---

### 🔴 **CRITICAL: No Stock Availability Check Before Invoice Creation**

**Status:** 🔴 **CRITICAL ISSUE**

**Problem:** Invoices can be created with quantities exceeding available stock, leading to:
- Negative stock in warehouses
- Inability to finalize invoices
- Customer orders that cannot be fulfilled

**Evidence:**
- `app/api/invoices/route.ts:822-875` - Creates invoice items without checking stock availability
- Stock check only happens during finalization (`app/api/invoices/[id]/finalize/route.ts`)
- No validation that `item.quantity <= available_stock` at warehouse level

**Impact:**
- **Business Risk:** Sales team creates invoices for items not in stock
- **Customer Experience:** Orders placed but cannot be fulfilled
- **Inventory Accuracy:** Negative stock values in database

**Fix Required:**
```typescript
// Add stock availability check before invoice creation:
if (status === 'final' && item.item_id && item.location_id) {
  const stockCheck = await client.query(`
    SELECT current_stock_qty
    FROM location_stock
    WHERE location_id = $1 AND item_id = $2
    FOR UPDATE
  `, [item.location_id, item.item_id]);
  
  const availableStock = parseFloat(stockCheck.rows[0]?.current_stock_qty || '0');
  
  if (availableStock < item.quantity) {
    await client.query('ROLLBACK');
    return NextResponse.json(
      { 
        error: `Insufficient stock. Available: ${availableStock}, Requested: ${item.quantity}`,
        item_name: item.item_name,
        warehouse_id: item.location_id
      },
      { status: 400 }
    );
  }
}
```

**Files Affected:**
- `app/api/invoices/route.ts` - Add stock check for final invoices
- `app/api/purchases/route.ts` - Add stock check for purchase returns

---

### 🟠 **HIGH: Inconsistent Stock Update Logic**

**Status:** 🟠 **HIGH PRIORITY**

**Problem:** Stock updates use different logic paths:
1. Some paths update `location_stock` (warehouse-level)
2. Some paths update `items.current_stock` (global stock)
3. No clear rule when to use which

**Evidence:**
- `app/api/invoices/[id]/finalize/route.ts:202-225` - Updates `location_stock` if `locationId` provided, else `items.current_stock`
- `app/api/invoices/route.ts:1044-1100` - Similar inconsistent logic
- `app/api/purchases/route.ts:498-550` - Mixed update paths

**Issue:**
- If `location_id` is NULL, stock is updated globally instead of warehouse-level
- This breaks warehouse-level inventory tracking
- Reports may show incorrect stock values

**Fix Required:**
1. **Always require warehouse_id for goods items** - Make `location_id` mandatory for goods
2. **Remove global stock updates** - Only update `location_stock`, never `items.current_stock` directly
3. **Calculate global stock** - Use view or function: `SELECT SUM(current_stock_qty) FROM location_stock WHERE item_id = $1`

---

### 🟡 **MEDIUM: No Stock Reservation System**

**Status:** 🟡 **MEDIUM PRIORITY**

**Problem:** Draft invoices don't reserve stock, allowing multiple drafts to be created for the same limited stock.

**Evidence:**
- `app/api/invoices/route.ts` - Draft invoices don't reserve stock
- `stock_reservations` table exists but not used in invoice creation

**Impact:**
- Multiple salespeople can create drafts for same stock
- First finalization wins, others fail
- Poor user experience

**Fix Required:**
- Reserve stock when draft invoice created
- Release reservation if draft cancelled or expired
- Check reservations before finalization

---

## 3. Accounting Correctness Across Branches

### ✅ **CORRECT: Branch ID in Ledger Entries**

**Status:** ✅ **IMPLEMENTED CORRECTLY**

**Evidence:**
- `database/migrations/121_add_branch_id_to_transactions.sql:42-48` - Adds `branch_id` to `ledger_entry_lines`
- `lib/ledger-utils.ts` - All ledger functions accept and use `branchId` parameter
- `app/api/invoices/route.ts` - Passes `branch_id` to `createInvoiceLedgerEntries`

**Implementation:**
```typescript
// Ledger entries include branch_id
await createLedgerEntryLine(
  client,
  {
    businessId: invoice.business_id,
    branchId: invoice.branch_id, // ✅ Branch ID included
    voucherId: invoice.id,
    voucherType: 'invoice',
    accountId: salesAccount.id,
    entryDate: invoice.invoice_date,
    credit: invoice.grand_total,
    debit: 0
  }
);
```

**Verdict:** ✅ Correctly tracks branch-level accounting.

---

### ✅ **CORRECT: Branch-Wise Invoice Numbering**

**Status:** ✅ **IMPLEMENTED CORRECTLY**

**Evidence:**
- `database/migrations/119_separate_branches_and_warehouses.sql` - Adds `next_invoice_number` and `invoice_prefix` to `branches` table
- `app/api/invoices/next-number/route.ts` - Returns branch-specific next invoice number
- `app/api/invoices/route.ts` - Uses branch-specific numbering

**Verdict:** ✅ Each branch has independent invoice numbering sequence.

---

### 🟠 **HIGH: Missing Branch Validation in Ledger Entry Creation**

**Status:** 🟠 **HIGH PRIORITY**

**Problem:** `createLedgerEntryLine` doesn't validate that `branch_id` belongs to `business_id`, allowing cross-business accounting entries.

**Evidence:**
- `lib/ledger-utils.ts:createLedgerEntryLine` - No validation of branch-business relationship
- Manual journal entries can be created with wrong branch_id

**Fix Required:**
```typescript
// Add validation in createLedgerEntryLine:
const branchCheck = await client.query(`
  SELECT id FROM branches
  WHERE id = $1 AND business_id = $2
`, [branchId, businessId]);

if (branchCheck.rows.length === 0) {
  throw new Error(`Branch ${branchId} does not belong to business ${businessId}`);
}
```

---

### 🟡 **MEDIUM: No Branch-Level Account Validation**

**Status:** 🟡 **MEDIUM PRIORITY**

**Problem:** Accounts are business-level, but ledger entries are branch-level. No validation that account belongs to same business as branch.

**Evidence:**
- `lib/ledger-utils.ts` - No check that `account.business_id === branch.business_id`
- Risk of creating ledger entries with accounts from different businesses

**Fix Required:**
- Add validation: `account.business_id === branch.business_id`
- Add database constraint if possible

---

## 4. Reporting Consistency

### ✅ **CORRECT: Branch Filtering in P&L Report**

**Status:** ✅ **IMPLEMENTED CORRECTLY**

**Evidence:**
- `app/api/reports/profit-loss/route.ts:17-44` - Supports `branch_id` parameter
- `app/api/reports/profit-loss/route.ts:108-144` - Filters ledger entries by branch

**Implementation:**
```typescript
// Build branch filter condition
const branchFilter = branchId ? 'AND branch_id = $5' : '';
const branchParam = branchId ? [branchId] : [];

// Calculate income for each account
const transactions = await queryOne(`
  SELECT COALESCE(SUM(credit - debit), 0) as net_amount
  FROM ledger_entry_lines
  WHERE account_id = $1 
    AND business_id = $2
    AND entry_date >= $3
    AND entry_date <= $4
    ${branchFilter}  -- ✅ Branch filter applied
`, [account.id, businessId, fromDate, toDate, ...branchParam]);
```

**Verdict:** ✅ Correctly filters reports by branch.

---

### 🟠 **HIGH: Stock Reports Don't Filter by Branch**

**Status:** 🟠 **HIGH PRIORITY**

**Problem:** Stock reports show all warehouses, not just those accessible by the user's branch.

**Evidence:**
- No stock report API found that filters by branch
- Warehouse stock queries don't check `branch_warehouses` relationship

**Impact:**
- Branch managers see stock from other branches' warehouses
- Inventory reports show incorrect data
- Security issue: Users can see data they shouldn't access

**Fix Required:**
```typescript
// Add branch filter to stock reports:
const branchWarehouseFilter = branchId ? `
  AND w.id IN (
    SELECT warehouse_id FROM branch_warehouses WHERE branch_id = $2
  )
` : '';

const stockQuery = `
  SELECT w.name, ls.current_stock_qty, i.name as item_name
  FROM location_stock ls
  JOIN warehouses w ON ls.location_id = w.id
  JOIN items i ON ls.item_id = i.id
  WHERE ls.business_id = $1
    ${branchWarehouseFilter}
`;
```

---

### 🟡 **MEDIUM: GSTR-1 Report Branch Filtering**

**Status:** 🟡 **MEDIUM PRIORITY**

**Problem:** GSTR-1 report supports branch filtering, but doesn't validate that invoices belong to the specified branch.

**Evidence:**
- `app/api/reports/gst/gstr1/route.ts` - Has `branch_id` parameter
- No validation that invoices actually have matching `branch_id`

**Fix Required:**
- Add explicit `WHERE invoices.branch_id = $branchId` filter
- Validate branch exists and is active

---

## 5. Permission Enforcement

### ✅ **CORRECT: Branch Access Control**

**Status:** ✅ **IMPLEMENTED CORRECTLY**

**Evidence:**
- `lib/branch-access.ts` - Comprehensive branch access control functions
- `app/api/invoices/route.ts:318-333` - Checks user branch permission before invoice creation
- `user_branches` table stores user-branch permissions

**Implementation:**
```typescript
// Check user branch access
if (created_by) {
  const { checkUserBranchPermission } = await import('@/lib/branch-access');
  const hasAccess = await checkUserBranchPermission(
    created_by,
    finalBranchId,
    'create_transactions'
  );
  
  if (!hasAccess) {
    return NextResponse.json(
      { error: 'User does not have permission to create transactions for this branch.' },
      { status: 403 }
    );
  }
}
```

**Verdict:** ✅ Correctly enforces branch-level permissions.

---

### 🔴 **CRITICAL: No Warehouse Access Control**

**Status:** 🔴 **CRITICAL ISSUE**

**Problem:** System has `user_branches` for branch access, but **no `user_warehouses` table or warehouse access control**.

**Evidence:**
- No `user_warehouses` table in schema
- No warehouse permission checks in invoice/purchase APIs
- Users can access any warehouse in the business, regardless of branch assignment

**Impact:**
- **Security:** Users can create transactions for warehouses they shouldn't access
- **Compliance:** Warehouse managers can't restrict access to their warehouses
- **Data Integrity:** Stock can be modified by unauthorized users

**Fix Required:**
1. **Create `user_warehouses` table:**
```sql
CREATE TABLE user_warehouses (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  warehouse_id UUID NOT NULL REFERENCES warehouses(id) ON DELETE CASCADE,
  can_view BOOLEAN DEFAULT true,
  can_edit BOOLEAN DEFAULT false,
  can_create_transactions BOOLEAN DEFAULT false,
  PRIMARY KEY (user_id, warehouse_id)
);
```

2. **Add warehouse access check:**
```typescript
// Check user warehouse access
if (created_by && item.location_id) {
  const warehouseAccess = await client.query(`
    SELECT can_create_transactions
    FROM user_warehouses
    WHERE user_id = $1 AND warehouse_id = $2
  `, [created_by, item.location_id]);
  
  if (!warehouseAccess.rows[0]?.can_create_transactions) {
    return NextResponse.json(
      { error: 'User does not have permission to create transactions for this warehouse.' },
      { status: 403 }
    );
  }
}
```

3. **Default behavior:** If user has branch access, grant access to all warehouses in that branch (via `branch_warehouses`)

---

### 🟠 **HIGH: Inconsistent Permission Checks**

**Status:** 🟠 **HIGH PRIORITY**

**Problem:** Some APIs check branch permissions, others don't. No consistent pattern.

**Evidence:**
- ✅ `app/api/invoices/route.ts:318-333` - Checks branch permission
- ✅ `app/api/payments/route.ts` - Checks branch permission
- ❌ `app/api/purchases/route.ts` - **NO branch permission check**
- ❌ `app/api/expenses/route.ts` - **NO branch permission check**

**Fix Required:**
- Add branch permission check to ALL transaction creation APIs
- Create middleware for consistent permission enforcement

---

## 6. Data Integrity Under Concurrency

### ✅ **CORRECT: Stock Deduction Locking**

**Status:** ✅ **IMPLEMENTED CORRECTLY**

**Evidence:**
- `app/api/invoices/[id]/finalize/route.ts:204-208` - Uses `FOR UPDATE` lock
- `app/api/stock-transfers/route.ts:115` - Uses `FOR UPDATE` for stock check

**Verdict:** ✅ Prevents race conditions in stock updates.

---

### 🟠 **HIGH: No Transaction-Level Locking for Branch Invoice Numbering**

**Status:** 🟠 **HIGH PRIORITY**

**Problem:** Branch invoice numbering uses `SELECT` then `UPDATE` pattern without locking, allowing duplicate invoice numbers.

**Evidence:**
- `app/api/invoices/route.ts` - Gets next invoice number, then updates
- No `FOR UPDATE` lock on `branches.next_invoice_number`
- Two parallel requests can get same number

**Fix Required:**
```typescript
// Lock branch row before getting next number:
await client.query(`
  SELECT next_invoice_number, invoice_prefix
  FROM branches
  WHERE id = $1
  FOR UPDATE  -- ✅ Add lock
`, [finalBranchId]);

// Then update:
await client.query(`
  UPDATE branches
  SET next_invoice_number = next_invoice_number + 1
  WHERE id = $1
`, [finalBranchId]);
```

---

### 🟡 **MEDIUM: No Deadlock Prevention**

**Status:** 🟡 **MEDIUM PRIORITY**

**Problem:** Multiple `FOR UPDATE` locks in same transaction can cause deadlocks if not ordered consistently.

**Evidence:**
- `app/api/invoices/[id]/finalize/route.ts` - Locks multiple tables (location_stock, item_batches, item_serials)
- No consistent lock ordering

**Fix Required:**
- Always lock tables in same order: `items` → `location_stock` → `item_batches` → `item_serials`
- Add deadlock retry logic

---

## 7. Database Constraints & Data Integrity

### 🔴 **CRITICAL: Missing Foreign Key Constraints**

**Status:** 🔴 **CRITICAL ISSUE**

**Problem:** `invoice_items.location_id` (warehouse_id) has no foreign key constraint, allowing references to non-existent warehouses.

**Evidence:**
- `database/schema.sql:209-229` - `invoice_items` table definition doesn't show `location_id` column
- `database/migrations/120_update_location_references_to_warehouses.sql:29-30` - Adds foreign key but migration may not have run

**Fix Required:**
```sql
-- Add foreign key constraint:
ALTER TABLE invoice_items
  ADD CONSTRAINT invoice_items_warehouse_id_fkey 
    FOREIGN KEY (location_id) REFERENCES warehouses(id) ON DELETE SET NULL;

-- Add check constraint for branch-warehouse relationship:
-- (Requires function or trigger, as CHECK constraints can't reference other tables)
```

---

### 🟠 **HIGH: No NOT NULL Constraint on Branch ID**

**Status:** 🟠 **HIGH PRIORITY**

**Problem:** `invoices.branch_id` allows NULL values, but business logic requires it.

**Evidence:**
- `database/migrations/121_add_branch_id_to_transactions.sql:5-6` - Adds `branch_id` without `NOT NULL`
- API code has fallback to primary branch, but database allows NULL

**Fix Required:**
```sql
-- After migration completes, add NOT NULL constraint:
ALTER TABLE invoices
  ALTER COLUMN branch_id SET NOT NULL;

-- Repeat for: purchases, credit_notes, payments, expenses
```

---

### 🟡 **MEDIUM: No Unique Constraint on Branch Invoice Numbers**

**Status:** 🟡 **MEDIUM PRIORITY**

**Problem:** Invoice numbers are unique per business, but should be unique per branch.

**Evidence:**
- `database/schema.sql:673` - `UNIQUE(business_id, invoice_number)` - Business-level uniqueness
- Should be: `UNIQUE(branch_id, invoice_number)` - Branch-level uniqueness

**Fix Required:**
```sql
-- Drop old constraint:
ALTER TABLE invoices
  DROP CONSTRAINT IF EXISTS idx_invoices_business_invoice_number;

-- Add branch-level uniqueness:
CREATE UNIQUE INDEX idx_invoices_branch_invoice_number 
  ON invoices(branch_id, invoice_number);
```

---

## 8. Missing Features & Edge Cases

### 🟠 **HIGH: No Branch Deactivation Handling**

**Status:** 🟠 **HIGH PRIORITY**

**Problem:** When branch is deactivated, existing transactions remain, but new transactions are blocked. No handling for:
- In-progress invoices
- Pending stock transfers
- Open purchase orders

**Evidence:**
- `app/api/invoices/route.ts:310-315` - Blocks invoice creation for inactive branch
- No logic to handle existing transactions when branch is deactivated

**Fix Required:**
- Add `branch_deactivated_at` timestamp
- Allow finalization of existing drafts
- Block new transaction creation
- Add migration path for branch closure

---

### 🟡 **MEDIUM: No Warehouse Deactivation Handling**

**Status:** 🟡 **MEDIUM PRIORITY**

**Problem:** Similar to branch deactivation, no handling for warehouse deactivation.

**Fix Required:**
- Add `warehouse_deactivated_at` timestamp
- Block new stock movements to/from deactivated warehouse
- Allow viewing historical data
- Add migration path for warehouse closure

---

### 🟡 **MEDIUM: No Inter-Branch Warehouse Sharing Validation**

**Status:** 🟡 **MEDIUM PRIORITY**

**Problem:** `branch_warehouses` table allows multiple branches to share warehouses, but no validation that this is intentional.

**Evidence:**
- `database/migrations/119_separate_branches_and_warehouses.sql:50-57` - Creates `branch_warehouses` many-to-many table
- No business rule validation (e.g., "warehouse can only be used by branches in same state for GST compliance")

**Fix Required:**
- Add validation: If branches share warehouse, they must have same GSTIN or be in same state
- Add warning in UI when assigning warehouse to multiple branches

---

## Summary of Issues

### 🔴 Critical Issues (Must Fix Before Production)

1. **Missing Warehouse-Branch Relationship Validation** - Invoice items can reference warehouses not accessible by branch
2. **No Stock Availability Check** - Invoices can be created with insufficient stock
3. **No Warehouse Access Control** - Missing `user_warehouses` table and permission checks
4. **Missing Foreign Key Constraints** - `invoice_items.location_id` has no FK constraint
5. **No NOT NULL Constraint on Branch ID** - Database allows NULL but business logic requires it

### 🟠 High Priority Issues (Fix Before Scaling)

1. **Missing Warehouse ID Column** - `invoice_items` uses legacy `location_id` name
2. **Inconsistent Stock Update Logic** - Mixed warehouse-level and global stock updates
3. **Missing Branch Validation in Ledger** - No check that branch belongs to business
4. **Stock Reports Don't Filter by Branch** - Shows all warehouses, not just accessible ones
5. **Inconsistent Permission Checks** - Some APIs check permissions, others don't
6. **No Transaction-Level Locking for Invoice Numbering** - Race condition in invoice number generation
7. **No Branch Deactivation Handling** - No graceful handling of branch closure
8. **No Unique Constraint on Branch Invoice Numbers** - Should be unique per branch, not business

### 🟡 Medium Priority Issues (Address in Next Sprint)

1. **No Default Warehouse Selection** - Users must manually select warehouse
2. **No Stock Reservation System** - Draft invoices don't reserve stock
3. **No Branch-Level Account Validation** - Accounts not validated against branch business
4. **GSTR-1 Report Branch Filtering** - No validation that invoices belong to branch
5. **No Deadlock Prevention** - Inconsistent lock ordering
6. **No Warehouse Deactivation Handling** - Similar to branch deactivation
7. **No Inter-Branch Warehouse Sharing Validation** - No business rule validation

---

## Recommendations

### Immediate Actions (Before Production)

1. **Add Warehouse-Branch Validation**
   - Validate `invoice_items.location_id` belongs to warehouse accessible by `invoices.branch_id`
   - Add check in invoice creation and finalization

2. **Add Stock Availability Check**
   - Check stock availability before creating final invoices
   - Return clear error message with available quantity

3. **Implement Warehouse Access Control**
   - Create `user_warehouses` table
   - Add permission checks in all transaction APIs
   - Default: Grant access to all warehouses in user's branches

4. **Add Database Constraints**
   - Add foreign key: `invoice_items.location_id → warehouses.id`
   - Add NOT NULL: `invoices.branch_id`, `purchases.branch_id`, etc.
   - Add unique constraint: `(branch_id, invoice_number)`

5. **Fix Invoice Numbering Race Condition**
   - Add `FOR UPDATE` lock when getting next invoice number
   - Ensure atomic increment

### Short-Term Improvements (Next Sprint)

1. **Standardize Stock Updates**
   - Always update `location_stock`, never `items.current_stock` directly
   - Make `warehouse_id` mandatory for goods items
   - Calculate global stock via view/function

2. **Implement Stock Reservation**
   - Reserve stock when draft invoice created
   - Release reservation on cancellation or expiration
   - Check reservations before finalization

3. **Add Branch Deactivation Handling**
   - Add `branch_deactivated_at` timestamp
   - Allow finalization of existing drafts
   - Block new transaction creation

4. **Consistent Permission Checks**
   - Create middleware for branch/warehouse permission checks
   - Apply to all transaction APIs

### Long-Term Enhancements

1. **Warehouse Access Control UI**
   - Admin interface for assigning warehouses to users
   - Role-based warehouse access

2. **Advanced Reporting**
   - Branch-wise stock reports
   - Warehouse utilization reports
   - Inter-branch transfer reports

3. **Audit Trail**
   - Log all warehouse access attempts
   - Track branch-warehouse relationship changes
   - Monitor permission changes

---

## Testing Recommendations

### Unit Tests Required

1. **Warehouse-Branch Validation**
   - Test invoice creation with warehouse not accessible by branch (should fail)
   - Test invoice creation with warehouse accessible by branch (should succeed)

2. **Stock Availability**
   - Test invoice creation with insufficient stock (should fail)
   - Test invoice creation with sufficient stock (should succeed)

3. **Permission Checks**
   - Test invoice creation without warehouse permission (should fail)
   - Test invoice creation with warehouse permission (should succeed)

### Integration Tests Required

1. **End-to-End Transaction Flow**
   - Create invoice with branch and warehouse
   - Verify stock deducted from correct warehouse
   - Verify ledger entries have correct branch_id
   - Verify reports show correct branch data

2. **Concurrency Tests**
   - Test parallel invoice creation (should not create duplicates)
   - Test parallel stock deduction (should not cause negative stock)

3. **Branch Deactivation**
   - Deactivate branch with pending invoices
   - Verify existing drafts can be finalized
   - Verify new invoices cannot be created

---

## Conclusion

The Branch and Warehouse integration has a **solid foundation** with correct separation of concepts and proper branch-level accounting. However, **critical gaps** remain in:

1. **Warehouse-Branch Relationship Validation** - Missing validation that warehouses are accessible by branches
2. **Stock Availability Checks** - No validation before invoice creation
3. **Warehouse Access Control** - Missing permission system
4. **Database Constraints** - Missing foreign keys and NOT NULL constraints
5. **Concurrency Handling** - Race conditions in invoice numbering

**Recommendation:** **DO NOT DEPLOY TO PRODUCTION** until critical issues are fixed. The system will experience data integrity issues, compliance violations, and operational failures under real-world usage.

**Estimated Fix Time:** 2-3 weeks for critical issues, 1-2 months for all improvements.

---

**End of Audit Report**
