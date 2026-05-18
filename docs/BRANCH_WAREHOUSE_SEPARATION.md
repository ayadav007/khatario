# Branch and Warehouse Separation - Implementation Summary

## Overview
This document tracks the separation of Branches (accounting entities) and Warehouses (inventory storage) - a critical architectural fix for multi-branch businesses.

## Problem Statement
The original system used `business_locations` for both:
- **Branches**: Accounting/compliance entities (GSTIN, invoice numbering, financial reporting)
- **Warehouses**: Physical inventory storage locations

This caused:
- Branches incorrectly holding inventory
- No separation between accounting and inventory
- Transactions missing branch context
- Compliance issues (GST reporting, invoice numbering)

## Solution
Created separate tables:
- `branches`: Accounting/compliance entities
- `warehouses`: Inventory storage entities
- `branch_warehouses`: Many-to-many mapping

## Migrations Created

### Migration 119: Separate Branches and Warehouses
- Creates `branches` table
- Creates `warehouses` table
- Creates `branch_warehouses` mapping table
- Migrates existing `business_locations` data
- Updates `location_stock` to reference warehouses
- Updates `stock_transfers` to use warehouses

### Migration 120: Update Location References to Warehouses
- Updates `invoice_items.location_id` → `warehouses`
- Updates `credit_note_items.location_id` → `warehouses`
- Updates `stock_movements.location_id` → `warehouses`
- Updates `inventory_adjustments.location_id` → `warehouses`
- Updates `item_batches.location_id` → `warehouses`
- Updates `item_serials.location_id` → `warehouses`
- Updates `stock_reservations.location_id` → `warehouses`
- Updates `user_warehouses.warehouse_id` → `warehouses`

### Migration 121: Add branch_id to Transactions
- Adds `branch_id` to `invoices`
- Adds `branch_id` to `purchases`
- Adds `branch_id` to `credit_notes`
- Adds `branch_id` to `payments`
- Adds `branch_id` to `expenses`
- Adds `branch_id` to `ledger_entry_lines`
- Migrates existing transactions to primary branch

## API Changes

### New APIs
- `GET/POST /api/branches` - Branch management
- `GET/POST /api/warehouses` - Warehouse management

### Updated APIs
- `POST /api/invoices` - Now requires `branch_id`
  - Validates branch exists and is active
  - Falls back to primary branch if not provided
  - Adds `branch_id` to invoice record

### APIs Still Needing Updates
- `POST /api/purchases` - Add branch_id requirement
- `POST /api/credit-notes` - Add branch_id requirement
- `POST /api/payments` - Add branch_id requirement
- `POST /api/expenses` - Add branch_id requirement
- `GET /api/locations` - Deprecate or redirect to branches/warehouses
- All stock-related APIs - Already use warehouses (via location_id)

## Database Schema

### Branches Table
```sql
branches {
  id UUID PRIMARY KEY
  business_id UUID
  name VARCHAR(200)
  branch_code VARCHAR(50)
  gstin VARCHAR(15)          -- Branch-specific GSTIN
  address_line1, address_line2
  city, state, state_code, pincode
  phone, email
  branch_type VARCHAR(50)    -- 'retail', 'warehouse', 'office', 'franchise', 'online'
  is_primary BOOLEAN
  is_active BOOLEAN
  invoice_prefix VARCHAR(10)
  next_invoice_number INTEGER
}
```

### Warehouses Table
```sql
warehouses {
  id UUID PRIMARY KEY
  business_id UUID
  branch_id UUID             -- Optional: primary branch using this warehouse
  name VARCHAR(200)
  warehouse_code VARCHAR(50)
  address_line1, address_line2
  city, state, pincode
  warehouse_type VARCHAR(50) -- 'physical', 'virtual', 'damaged_holding'
  is_active BOOLEAN
}
```

### Branch-Warehouse Mapping
```sql
branch_warehouses {
  branch_id UUID
  warehouse_id UUID
  is_primary BOOLEAN         -- Primary warehouse for this branch
  PRIMARY KEY (branch_id, warehouse_id)
}
```

## Transaction Model

### Correct Model
- **Invoices**: `branch_id` (accounting) + `warehouse_id` in items (inventory)
- **Purchases**: `branch_id` (accounting) + `warehouse_id` in items (inventory)
- **Stock Transfers**: `from_warehouse_id` + `to_warehouse_id` (inventory only)
- **Ledger Entries**: `branch_id` (accounting context)

## Next Steps

### P0 (Critical - Blocking Production)
1. ✅ Create branches and warehouses tables
2. ✅ Migrate existing data
3. ✅ Add branch_id to transaction tables
4. ✅ Update invoices API
5. ⏳ Update purchases API
6. ⏳ Update credit-notes API
7. ⏳ Update payments API
8. ⏳ Update expenses API
9. ⏳ Update ledger entry creation

### P1 (High Priority)
10. ⏳ Branch-wise invoice numbering
11. ⏳ Branch-wise GST reporting
12. ⏳ User-branch access control
13. ⏳ Branch-wise financial reports

### P2 (Medium Priority)
14. ⏳ Deprecate `/api/locations` endpoint
15. ⏳ Update frontend to use branches/warehouses
16. ⏳ Branch deactivation validation
17. ⏳ Inter-branch transaction support

## Testing Checklist
- [ ] Migration runs successfully on existing database
- [ ] Existing invoices assigned to primary branch
- [ ] New invoices require branch_id
- [ ] Stock operations use warehouses correctly
- [ ] No data loss during migration
- [ ] Backward compatibility maintained where possible

## Rollback Plan
If migration fails:
1. Keep `business_locations` table (not dropped)
2. All new tables can be dropped
3. Foreign key constraints can be reverted
4. Original APIs remain functional

## Notes
- `business_locations` table is NOT dropped (for reference)
- Can be dropped in future migration after verification
- All location_id references now point to warehouses
- branch_id is added to all transaction tables
- Existing transactions migrated to primary branch
