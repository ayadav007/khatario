# Branch vs Organization — System Rules

## Core Principle

```
BRANCH = Filter + Location + Operations
ORG    = Books + Tax + Ownership
```

**Data lives ONCE → Branch decides WHERE it belongs**

Branches are **operational filters on shared books**, not separate accounting entities.

---

## What is SHARED (Business-Level)

These entities exist **once per business** and are shared across all branches:

### Master Data
- **Items / Products**: One catalog for the entire business
- **Customers**: Shared customer database
- **Suppliers**: Shared supplier database
- **Chart of Accounts**: One set of books per business
- **Tax Rules**: Business-level tax configuration
- **Account Groups**: Shared account structure

### Business Configuration
- **Business Profile**: Name, PAN, registration details
- **Subscription**: Business-level feature access
- **Users**: Users can belong to multiple branches
- **Roles & Permissions**: Business-level role definitions

---

## What is BRANCH-SPECIFIC

These entities are tagged with `branch_id` and filtered by branch:

### Transactions
- **Invoices**: Each invoice belongs to a branch
- **Purchases**: Each purchase belongs to a branch
- **Payments**: Each payment belongs to a branch
- **Expenses**: Each expense belongs to a branch
- **Journal Entries**: Each journal entry belongs to a branch
- **Ledger Entries**: Inherit `branch_id` from source transaction

### Operational Data
- **Invoice Numbering**: Per-branch document prefixes and sequences
- **Warehouses**: Can be linked to specific branches
- **Stock Movements**: Inferred from branch-tagged transactions
- **GSTIN**: Can be per-branch (for multi-state operations)

### Branch Profile
- **Branch Name**: Operational name
- **Branch Address**: Physical location
- **Branch GSTIN**: If different from main business
- **Branch Contact**: Phone, email for branch

---

## What MUST NEVER be Branch-Specific

These must **ALWAYS** remain business-level:

- ❌ **Chart of Accounts**: One set of accounts for entire business
- ❌ **Account Balances**: Calculated from all branches (can be filtered for reporting)
- ❌ **Items Master**: One item catalog
- ❌ **Customers Master**: One customer database
- ❌ **Suppliers Master**: One supplier database
- ❌ **Tax Rules**: Business-level configuration
- ❌ **Opening Balances**: Business-level (no `branch_id`)

---

## Branch Filtering Rules

### For Branch Users
- **Default Behavior**: See only transactions from their assigned branches
- **No Override**: Cannot view other branches' data
- **API Enforcement**: All list APIs filter by `accessibleBranchIds`

### For Admins
- **Default Behavior**: See all branches (consolidated view)
- **Branch-Specific View**: Can filter by `branch_id=<id>` for specific branch
- **Consolidated View**: Can explicitly request `branch_id=ALL` for all branches
- **Reports**: Support both consolidated and branch-specific views

---

## Ledger Entry Rules

### Transactional Entries (MUST have `branch_id`)
- Invoice ledger entries → inherit from invoice
- Purchase ledger entries → inherit from purchase
- Payment ledger entries → inherit from payment
- Expense ledger entries → inherit from expense
- Journal entry lines → inherit from journal entry

### Business-Level Entries (MUST NOT have `branch_id`)
- Opening balance entries → business-level, no `branch_id`
- System adjustments → business-level (if applicable)

---

## Reporting Behavior

### Consolidated Reports (All Branches)
- **Access**: Admin only
- **Trigger**: `branch_id=ALL` or no `branch_id` parameter
- **Behavior**: Sum all branch transactions
- **Use Case**: Business-wide financial statements

### Branch-Specific Reports
- **Access**: Branch users (their branches) or admins (any branch)
- **Trigger**: `branch_id=<specific-branch-id>`
- **Behavior**: Filter transactions by branch
- **Use Case**: Branch performance analysis

### Query-Level Filtering
- **Implementation**: SQL `WHERE branch_id = ...` clauses
- **NOT**: Separate balance tables per branch
- **NOT**: Duplicate accounts per branch
- **NOT**: Separate books per branch

---

## Access Control

### User-Branch Assignment
- Users can be assigned to multiple branches
- Permissions: `can_view`, `can_edit`, `can_delete`, `can_create_transactions`
- Access is enforced at API level via `getUserAccessibleBranchIds()`

### Admin Override
- Admins (users with `settings.read` permission or `is_primary_admin=true`)
- Can view all branches
- Can explicitly request consolidated views
- Branch filtering is optional for admins

---

## Data Integrity Rules

### Invariant Checks
1. **Transactional ledger entries MUST have `branch_id`**
   - Exception: Opening balance entries (business-level)
   - Validation: Enforced in `createLedgerEntryLine()`

2. **Branch users MUST be scoped by allowed branches**
   - Enforcement: API-level filtering via `accessibleBranchIds`
   - Failure: Returns empty result if no branch access

3. **Admin consolidated view MUST be explicit**
   - Default: Admins see all branches
   - Explicit: `branch_id=ALL` for consolidated reports

### Validation Points
- Invoice creation → validates `branch_id` exists and is active
- Purchase creation → validates `branch_id` exists and is active
- Payment creation → validates `branch_id` exists and is active
- Expense creation → validates `branch_id` exists and is active
- Journal entry → validates `branch_id` exists and is active

---

## Common Pitfalls (DO NOT DO)

### ❌ Treating Branch as Organization
- **Wrong**: Creating separate Chart of Accounts per branch
- **Right**: One Chart of Accounts, filter transactions by branch

### ❌ Duplicating Master Data
- **Wrong**: `branch_items`, `branch_customers`, `branch_suppliers` tables
- **Right**: Shared master data, branch-tagged transactions

### ❌ Branch-Specific Balances
- **Wrong**: `account_balances_per_branch` table
- **Right**: Calculate balances on-demand with branch filter

### ❌ Separate Books
- **Wrong**: One set of books per branch
- **Right**: One set of books, filter by branch for reporting

---

## Implementation Checklist

When adding new features:

- [ ] If it's a transaction → Must have `branch_id`
- [ ] If it's master data → Must be business-level (shared)
- [ ] If it's a report → Must support branch filtering
- [ ] If it's a list API → Must filter by `accessibleBranchIds` for branch users
- [ ] If it creates ledger entries → Must pass `branch_id` from source transaction

---

## Examples

### ✅ Correct: Branch-Tagged Invoice
```sql
INSERT INTO invoices (business_id, branch_id, customer_id, ...)
VALUES ($1, $2, $3, ...);
-- branch_id = specific branch UUID
```

### ✅ Correct: Shared Customer
```sql
SELECT * FROM customers WHERE business_id = $1;
-- No branch_id filter - customers are shared
```

### ✅ Correct: Branch-Filtered Report
```sql
SELECT SUM(credit - debit) as net_amount
FROM ledger_entry_lines
WHERE account_id = $1
  AND business_id = $2
  AND branch_id = $3;  -- Filter by branch
```

### ❌ Wrong: Branch-Specific Account
```sql
-- DO NOT DO THIS
SELECT * FROM accounts WHERE branch_id = $1;
-- Accounts are shared, not branch-specific
```

### ❌ Wrong: Duplicate Items Per Branch
```sql
-- DO NOT DO THIS
SELECT * FROM branch_items WHERE branch_id = $1;
-- Items are shared, transactions are branch-tagged
```

---

## Summary

**Branches are operational filters on shared books.**

- Master data: Shared (business-level)
- Transactions: Branch-tagged
- Reports: Query-level filtering
- Access: Enforced at API level
- Books: One set per business

This model matches Zoho Books, Tally, and QuickBooks branch behavior.
