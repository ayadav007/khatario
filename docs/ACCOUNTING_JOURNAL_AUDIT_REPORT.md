# Accounting Journal System - Comprehensive Audit Report

**Date:** 2024  
**Scope:** Double-entry accounting correctness, auditability, and real-world compliance  
**Status:** ⚠️ **CRITICAL ISSUES FOUND**

---

## Executive Summary

The accounting journal system has a solid foundation with proper double-entry structure, but **critical gaps** exist in:
1. **Branch-level accounting** - `branch_id` not being set in ledger entries
2. **Debit notes** - No journal entries created
3. **Period locks** - No enforcement mechanism
4. **Immutability** - Ledger entries can be edited directly

---

## 1. Journal Creation Validation

### ✅ **Sales Invoices**
**Status:** ✅ **CORRECT**
- Ledger entries created via `createInvoiceLedgerEntries()`
- **Timing:** Only when `status = 'final'` (correct - drafts don't create entries)
- **Entries:**
  - Cash Sale: `Dr. Cash/Bank, Cr. Sales`
  - Credit Sale: `Dr. Accounts Receivable, Cr. Sales`
  - With COGS: `Dr. COGS, Cr. Inventory` (if inventory items)
- **Location:** `app/api/invoices/route.ts:1239`

### ✅ **Purchase Bills**
**Status:** ✅ **CORRECT**
- Ledger entries created via `createPurchaseLedgerEntries()`
- **Entries:**
  - Cash Purchase: `Dr. Purchases, Cr. Cash/Bank`
  - Credit Purchase: `Dr. Purchases, Cr. Accounts Payable`
  - With Inventory: `Dr. Inventory, Cr. Purchases` (transfer to inventory)
- **Location:** `app/api/purchases/route.ts:682`

### ✅ **Credit Notes (Sales Returns)**
**Status:** ✅ **CORRECT**
- Ledger entries created via `createCreditNoteLedgerEntries()`
- **Entries:**
  - `Dr. Sales, Cr. Accounts Receivable` (reversal)
  - With COGS: `Cr. COGS, Dr. Inventory` (reversal)
- **Location:** `app/api/credit-notes/route.ts:383`

### ❌ **Debit Notes**
**Status:** ❌ **CRITICAL - MISSING JOURNAL ENTRIES**
- **Issue:** No ledger entries created for debit notes
- **Impact:** Debit notes increase receivables but don't create accounting entries
- **Expected Entries:**
  - `Dr. Accounts Receivable, Cr. Sales` (additional charge)
  - With COGS: `Dr. COGS, Cr. Inventory` (if inventory items)
- **Location:** `app/api/debit-notes/route.ts` - No ledger entry creation
- **Fix Required:** Add `createDebitNoteLedgerEntries()` function

### ✅ **Inventory Adjustments**
**Status:** ✅ **CORRECT**
- **Quantity Adjustments:**
  - INCREASE: `Dr. Inventory, Cr. Adjustment Account`
  - DECREASE: `Dr. Adjustment Account, Cr. Inventory`
- **Value Adjustments:**
  - INCREASE: `Dr. Inventory, Cr. Adjustment Account`
  - DECREASE: `Dr. Adjustment Account, Cr. Inventory`
- **Location:** `lib/inventory-adjustment-service.ts:236-321, 474-553`
- **Account Mapping:** Reason codes mapped to appropriate expense/income accounts

### ✅ **Stock Write-offs**
**Status:** ✅ **HANDLED VIA INVENTORY ADJUSTMENTS**
- Handled via quantity adjustments with reason codes:
  - `DAMAGE` → Damage/Loss Expense
  - `THEFT` → Theft Loss
  - `EXPIRED` → Expiry Loss
- **Location:** `lib/inventory-adjustment-service.ts:598-636`

### ✅ **Stock Revaluation**
**Status:** ✅ **HANDLED VIA INVENTORY ADJUSTMENTS**
- Handled via value adjustments with reason codes:
  - `REVALUATION` → Revaluation Gain/Loss
  - `WRITE_DOWN` → Write Down Expense
- **Location:** `lib/inventory-adjustment-service.ts:377-578`

---

## 2. Inventory Accounting Rules

### ✅ **Inventory Asset Account**
**Status:** ✅ **CORRECT**
- Uses `getDefaultAccounts()` to fetch inventory account (code: 1104)
- Properly debited on purchases and adjustments
- Properly credited on sales

### ✅ **Cost of Goods Sold (COGS)**
**Status:** ✅ **CORRECT**
- COGS calculated from item `purchase_price` × quantity
- Posted as: `Dr. COGS, Cr. Inventory` on sales
- Reversed on credit notes: `Cr. COGS, Dr. Inventory`
- **Location:** `app/api/invoices/route.ts:1212-1230`

### ✅ **Inventory Loss Accounts**
**Status:** ✅ **CORRECT**
- Reason codes mapped to appropriate accounts:
  - `DAMAGE` → 5103 (Damage/Loss Expense)
  - `THEFT` → 5104 (Theft Loss)
  - `EXPIRED` → 5105 (Expiry Loss)
  - `REVALUATION` → 5109 (Revaluation Loss) / 4109 (Revaluation Gain)
  - `WRITE_DOWN` → 5110 (Write Down Expense)
- **Location:** `lib/inventory-adjustment-service.ts:598-636`

### ✅ **Value vs Quantity Adjustments**
**Status:** ✅ **CORRECT**
- **Quantity Adjustments:** Change stock quantity, value = quantity × unit_cost
- **Value Adjustments:** Change unit cost, quantity unchanged
- Both create proper journal entries

### ⚠️ **No Fake Revenue/Purchases**
**Status:** ⚠️ **MOSTLY CORRECT**
- Revenue only created on finalized invoices (correct)
- Purchases only created on finalized purchases (correct)
- **Concern:** No validation to prevent duplicate ledger entries if invoice is finalized twice

---

## 3. Branch-Level Accounting

### ❌ **CRITICAL: Branch ID Not Set in Ledger Entries**
**Status:** ❌ **CRITICAL ISSUE**

**Problem:**
- `branch_id` column exists in `ledger_entry_lines` table (migration 121)
- **BUT:** `createLedgerEntryLine()` function does NOT accept or set `branch_id`
- **Result:** All ledger entries have `branch_id = NULL`, breaking branch-wise accounting

**Impact:**
- Branch-wise P&L reports will be incorrect (includes all branches)
- Branch-wise Balance Sheet will be incorrect
- Cannot track branch-level profitability
- Compliance issue for multi-branch businesses

**Evidence:**
```typescript
// lib/ledger-utils.ts:230-281
export async function createLedgerEntryLine(params: {
  businessId: string;
  voucherId: string;
  voucherType: 'invoice' | 'payment' | 'purchase' | 'expense' | 'journal' | 'opening_balance';
  accountId: string;
  entryDate: Date | string;
  debit: number;
  credit: number;
  narration?: string;
  referenceNumber?: string;
  // ❌ MISSING: branchId?: string;
}): Promise<string> {
  // INSERT statement does NOT include branch_id
  const result = await db.queryOne<{ id: string }>(
    `INSERT INTO ledger_entry_lines (
      business_id, voucher_id, voucher_type, account_id, entry_date,
      debit, credit, narration, reference_number
      // ❌ MISSING: branch_id
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    RETURNING id`,
    [...]
  );
}
```

**Fix Required:**
1. Add `branchId` parameter to `createLedgerEntryLine()`
2. Update all ledger entry creation functions to pass `branch_id`
3. Derive `branch_id` from transaction (invoice, purchase, etc.)
4. Update INSERT statement to include `branch_id`

**Files to Fix:**
- `lib/ledger-utils.ts` - Add branchId parameter
- `lib/inventory-adjustment-service.ts` - Pass branchId (if available)
- All transaction APIs that create ledger entries

### ⚠️ **Branch-Wise Ledger Queries**
**Status:** ⚠️ **PARTIALLY IMPLEMENTED**
- P&L and Balance Sheet reports support `branch_id` filter
- **BUT:** Since `branch_id` is NULL in ledger entries, filtering won't work correctly
- **Location:** `app/api/reports/profit-loss/route.ts`, `app/api/reports/balance-sheet/route.ts`

### ✅ **Consolidated Accounting**
**Status:** ✅ **SUPPORTED**
- Reports work without `branch_id` filter (all branches)
- Once `branch_id` is fixed, consolidated reports will work correctly

---

## 4. Audit & Integrity

### ❌ **Immutability - Ledger Entries Can Be Edited**
**Status:** ❌ **CRITICAL ISSUE**

**Problem:**
- `ledger_entry_lines` table has NO `is_editable` or `is_locked` column
- No database constraints preventing updates
- No application-level checks preventing edits
- **Result:** Ledger entries can be modified after creation, breaking audit trail

**Expected Behavior:**
- Ledger entries should be immutable once created
- Changes should be made via reversal entries, not direct edits
- Only exception: Draft entries before finalization

**Evidence:**
```sql
-- database/migrations/064_enhanced_ledger.sql
CREATE TABLE IF NOT EXISTS ledger_entry_lines (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id UUID REFERENCES businesses(id) ON DELETE CASCADE,
    voucher_id UUID,
    voucher_type VARCHAR(50) NOT NULL,
    account_id UUID REFERENCES accounts(id) ON DELETE RESTRICT,
    entry_date DATE NOT NULL,
    debit DECIMAL(15,2) DEFAULT 0,
    credit DECIMAL(15,2) DEFAULT 0,
    narration TEXT,
    reference_number VARCHAR(100),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    -- ❌ NO is_editable, is_locked, or updated_at columns
    -- ❌ NO triggers preventing updates
);
```

**Fix Required:**
1. Add `is_editable BOOLEAN DEFAULT false` column
2. Add `updated_at TIMESTAMP` column
3. Add database trigger to prevent updates when `is_editable = false`
4. Add application-level checks in update APIs

### ✅ **Reversal Entries**
**Status:** ✅ **SUPPORTED**
- Journal entries support reversal via `is_reversing` flag
- Reverses debit/credit automatically
- **Location:** `app/api/journal-entries/route.ts:212-240`

### ✅ **Transaction ↔ Journal Traceability**
**Status:** ✅ **CORRECT**
- `voucher_id` links ledger entries to transactions
- `voucher_type` identifies transaction type
- `reference_number` stores invoice/purchase number
- **Location:** `lib/ledger-utils.ts:230-281`

### ❌ **Period Lock Enforcement**
**Status:** ❌ **NOT IMPLEMENTED**

**Problem:**
- No mechanism to lock accounting periods
- No validation preventing entries in locked periods
- No `period_locks` table or similar

**Expected Behavior:**
- Once a period is closed/locked, no new entries should be allowed
- Only reversal entries should be allowed (with proper authorization)
- Period locks should be branch-specific (if multi-branch)

**Fix Required:**
1. Create `period_locks` table:
   ```sql
   CREATE TABLE period_locks (
     id UUID PRIMARY KEY,
     business_id UUID,
     branch_id UUID, -- NULL for business-wide lock
     financial_year VARCHAR(9),
     period_start DATE,
     period_end DATE,
     locked_at TIMESTAMP,
     locked_by UUID,
     is_locked BOOLEAN DEFAULT true
   );
   ```
2. Add validation in `createLedgerEntryLine()` to check period locks
3. Create API to lock/unlock periods

---

## 5. Double-Entry Balance Validation

### ✅ **Journal Entry Validation**
**Status:** ✅ **CORRECT**
- Journal entries validate `debit = credit` before creation
- Individual lines validated (not both debit and credit)
- **Location:** `app/api/journal-entries/route.ts:159-195`

### ⚠️ **Voucher-Level Balance Validation**
**Status:** ⚠️ **PARTIAL**

**Current State:**
- Application validates balance before creating entries
- **BUT:** No database constraint ensuring voucher-level balance
- **Risk:** If entries created outside application, balance could be broken

**Evidence:**
```sql
-- No constraint ensuring SUM(debit) = SUM(credit) per voucher_id
CREATE TABLE IF NOT EXISTS ledger_entry_lines (
    -- ...
    CONSTRAINT check_debit_credit CHECK (
        (debit > 0 AND credit = 0) OR (debit = 0 AND credit > 0)
    )
    -- ❌ Missing: Voucher-level balance constraint
);
```

**Fix Required:**
1. Add database function to validate voucher balance
2. Add trigger to validate on INSERT/UPDATE
3. Or add periodic validation job

### ✅ **Overall Ledger Balance**
**Status:** ✅ **VALIDATED**
- Verification queries exist in `verify_ledger_integration.sql`
- Can be run to check overall balance

---

## 6. Missing Journal Events

### ❌ **Debit Notes**
- **Status:** Missing journal entries
- **Fix:** Implement `createDebitNoteLedgerEntries()`

### ⚠️ **Payment Entries**
- **Status:** ✅ Handled via `createPaymentLedgerEntries()`
- **Note:** Payments are separate transactions, not part of invoice creation

### ⚠️ **Expense Entries**
- **Status:** ✅ Handled via `createExpenseLedgerEntries()`
- **Location:** `lib/ledger-utils.ts:515-578`

---

## 7. Accounting Violations Found

### 🔴 **P0 - CRITICAL**

1. **Branch ID Not Set in Ledger Entries**
   - **Impact:** Branch-wise accounting broken
   - **Fix:** Add `branchId` parameter to all ledger entry functions

2. **Debit Notes Missing Journal Entries**
   - **Impact:** Receivables increased without accounting entries
   - **Fix:** Implement debit note ledger entry creation

3. **Ledger Entries Are Editable**
   - **Impact:** Audit trail can be tampered with
   - **Fix:** Add immutability constraints

### 🟡 **P1 - HIGH PRIORITY**

4. **No Period Lock Enforcement**
   - **Impact:** Entries can be created in closed periods
   - **Fix:** Implement period lock system

5. **No Voucher-Level Balance Constraint**
   - **Impact:** Database-level integrity not enforced
   - **Fix:** Add database constraints or triggers

---

## 8. Recommended Fixes

### Fix 1: Add Branch ID to Ledger Entries

```typescript
// lib/ledger-utils.ts
export async function createLedgerEntryLine(params: {
  businessId: string;
  voucherId: string;
  voucherType: 'invoice' | 'payment' | 'purchase' | 'expense' | 'journal' | 'opening_balance';
  accountId: string;
  entryDate: Date | string;
  debit: number;
  credit: number;
  narration?: string;
  referenceNumber?: string;
  branchId?: string; // ✅ ADD THIS
}): Promise<string> {
  const result = await db.queryOne<{ id: string }>(
    `INSERT INTO ledger_entry_lines (
      business_id, voucher_id, voucher_type, account_id, entry_date,
      debit, credit, narration, reference_number, branch_id
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
    RETURNING id`,
    [
      params.businessId,
      params.voucherId,
      params.voucherType,
      params.accountId,
      params.entryDate,
      params.debit || 0,
      params.credit || 0,
      params.narration || null,
      params.referenceNumber || null,
      params.branchId || null, // ✅ ADD THIS
    ]
  );
  return result?.id || '';
}
```

Then update all ledger entry creation functions to:
1. Accept `branchId` parameter
2. Derive from transaction (invoice.branch_id, purchase.branch_id, etc.)
3. Pass to `createLedgerEntryLine()`

### Fix 2: Implement Debit Note Ledger Entries

```typescript
// lib/ledger-utils.ts
export async function createDebitNoteLedgerEntries(params: {
  businessId: string;
  debitNoteId: string;
  debitNoteNumber: string;
  debitNoteDate: Date | string;
  grandTotal: number;
  customerId: string;
  branchId?: string;
  cogsAmount?: number;
}): Promise<void> {
  const accounts = await getDefaultAccounts(params.businessId);
  
  // Entry 1: Debit Accounts Receivable, Credit Sales
  await createLedgerEntryLine({
    businessId: params.businessId,
    voucherId: params.debitNoteId,
    voucherType: 'debit_note',
    accountId: accounts.accountsReceivable.id,
    entryDate: params.debitNoteDate,
    debit: params.grandTotal,
    credit: 0,
    narration: `Debit Note ${params.debitNoteNumber} - Additional charge`,
    referenceNumber: params.debitNoteNumber,
    branchId: params.branchId,
  });

  await createLedgerEntryLine({
    businessId: params.businessId,
    voucherId: params.debitNoteId,
    voucherType: 'debit_note',
    accountId: accounts.sales.id,
    entryDate: params.debitNoteDate,
    debit: 0,
    credit: params.grandTotal,
    narration: `Sales - Debit Note ${params.debitNoteNumber}`,
    referenceNumber: params.debitNoteNumber,
    branchId: params.branchId,
  });

  // COGS entries if applicable
  if (params.cogsAmount > 0 && accounts.cogs && accounts.inventory) {
    await createLedgerEntryLine({
      businessId: params.businessId,
      voucherId: params.debitNoteId,
      voucherType: 'debit_note',
      accountId: accounts.cogs.id,
      entryDate: params.debitNoteDate,
      debit: params.cogsAmount,
      credit: 0,
      narration: `COGS - Debit Note ${params.debitNoteNumber}`,
      referenceNumber: params.debitNoteNumber,
      branchId: params.branchId,
    });

    await createLedgerEntryLine({
      businessId: params.businessId,
      voucherId: params.debitNoteId,
      voucherType: 'debit_note',
      accountId: accounts.inventory.id,
      entryDate: params.debitNoteDate,
      debit: 0,
      credit: params.cogsAmount,
      narration: `Inventory reduction - Debit Note ${params.debitNoteNumber}`,
      referenceNumber: params.debitNoteNumber,
      branchId: params.branchId,
    });
  }
}
```

### Fix 3: Add Immutability Constraints

```sql
-- Migration: Add immutability to ledger_entry_lines
ALTER TABLE ledger_entry_lines
  ADD COLUMN IF NOT EXISTS is_editable BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP;

-- Create trigger to prevent updates when not editable
CREATE OR REPLACE FUNCTION prevent_ledger_entry_update()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.is_editable = false THEN
    RAISE EXCEPTION 'Ledger entry is immutable. Use reversal entries instead.';
  END IF;
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER prevent_ledger_entry_update_trigger
  BEFORE UPDATE ON ledger_entry_lines
  FOR EACH ROW
  EXECUTE FUNCTION prevent_ledger_entry_update();
```

### Fix 4: Implement Period Locks

```sql
-- Migration: Create period_locks table
CREATE TABLE IF NOT EXISTS period_locks (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  branch_id UUID REFERENCES branches(id) ON DELETE CASCADE,
  financial_year VARCHAR(9) NOT NULL,
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  is_locked BOOLEAN DEFAULT true,
  locked_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  locked_by UUID REFERENCES users(id),
  notes TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(business_id, branch_id, financial_year, period_start, period_end)
);

CREATE INDEX idx_period_locks_business ON period_locks(business_id, branch_id, financial_year);
```

Then add validation in `createLedgerEntryLine()`:
```typescript
// Check if period is locked
const periodLock = await db.queryOne(`
  SELECT id FROM period_locks
  WHERE business_id = $1
    AND (branch_id = $2 OR branch_id IS NULL)
    AND $3 BETWEEN period_start AND period_end
    AND is_locked = true
`, [businessId, branchId, entryDate]);

if (periodLock) {
  throw new Error('Cannot create ledger entry in locked period');
}
```

---

## 9. Enterprise Best Practices

### ✅ **Implemented:**
1. Double-entry structure
2. Voucher-based traceability
3. Account mapping system
4. COGS calculation and posting
5. Inventory adjustment accounting

### ❌ **Missing:**
1. Branch-level accounting (column exists but not used)
2. Period locks
3. Immutability enforcement
4. Database-level balance constraints
5. Audit log for ledger entry changes

---

## 10. Testing Checklist

- [ ] Verify all invoices create ledger entries with correct branch_id
- [ ] Verify all purchases create ledger entries with correct branch_id
- [ ] Verify debit notes create ledger entries
- [ ] Verify inventory adjustments create journal entries
- [ ] Verify branch-wise P&L shows only that branch's entries
- [ ] Verify branch-wise Balance Sheet shows only that branch's entries
- [ ] Verify ledger entries cannot be edited after creation
- [ ] Verify period locks prevent entries in locked periods
- [ ] Verify double-entry balance for all vouchers
- [ ] Verify reversal entries work correctly

---

## Conclusion

The accounting journal system has a **solid foundation** but requires **critical fixes** before production use:

1. **P0 - Must Fix:**
   - Add `branch_id` to all ledger entries
   - Implement debit note journal entries
   - Add immutability constraints

2. **P1 - Should Fix:**
   - Implement period locks
   - Add voucher-level balance constraints

3. **P2 - Nice to Have:**
   - Audit log for ledger changes
   - Database-level balance validation triggers

**Recommendation:** Fix P0 issues immediately before enabling multi-branch accounting features.
