# Step 2 Complete: Add Missing Schema (purchase_items.location_id)

## ✅ COMPLETED

### Files Changed
1. `database/migrations/136_add_location_id_to_purchase_items.sql` - **NEW** migration
2. `app/api/purchases/route.ts` - Updated INSERT to include `location_id`

---

## Migration Details

### File: `database/migrations/136_add_location_id_to_purchase_items.sql`

**Changes:**
- Adds `location_id UUID REFERENCES warehouses(id) ON DELETE SET NULL` to `purchase_items`
- Creates index `idx_purchase_items_location` for performance
- Creates composite index `idx_purchase_items_location_item` for common queries
- Adds documentation comment

**Important Constraints:**
- ✅ Column is **nullable** (supports legacy purchases)
- ✅ **No defaults** (as requested)
- ✅ **No auto-fill** (as requested)
- ✅ References `warehouses` table (not `business_locations`)

---

## Code Updates

### Purchase Creation (`app/api/purchases/route.ts`)

**Before:**
```typescript
INSERT INTO purchase_items (
  purchase_id, item_id, item_name, hsn_sac, quantity,
  unit_price, discount_percent, discount_amount, taxable_value,
  tax_rate, tax_amount, cgst_amount, sgst_amount, igst_amount, line_total
)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
```

**After:**
```typescript
INSERT INTO purchase_items (
  purchase_id, item_id, item_name, hsn_sac, quantity,
  unit_price, discount_percent, discount_amount, taxable_value,
  tax_rate, tax_amount, cgst_amount, sgst_amount, igst_amount, line_total,
  location_id
)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
// ... with item.location_id || null as $16
```

---

## Schema Status

| Table | `location_id` Column | Status |
|-------|---------------------|--------|
| `invoice_items` | ✅ EXISTS | ✅ SAFE |
| `purchase_items` | ✅ **NOW EXISTS** | ✅ **FIXED** |
| `stock_movements` | ✅ EXISTS | ✅ SAFE |
| `inventory_adjustments` | ✅ EXISTS | ✅ SAFE |

---

## Impact

### ✅ Database Schema
- `purchase_items` now has `location_id` column
- Foreign key constraint to `warehouses` table
- Indexes created for performance

### ✅ Code Compatibility
- Purchase creation now stores `location_id`
- Purchase finalize already reads `row.location_id` (no change needed)
- Existing code paths continue to work

### ✅ Backward Compatibility
- Column is nullable - existing purchases remain valid
- No data migration required
- Legacy purchases will have `location_id = NULL`

---

## Next Steps

Ready for **Step 3**: Fix inventory adjustment service
