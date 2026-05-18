# Step 1 Complete: Remove Silent Fallbacks (Dual-Mode Support)

## ✅ COMPLETED

### Files Changed
1. `lib/warehouse-mode.ts` - **NEW** helper function
2. `app/api/purchases/route.ts`
3. `app/api/purchases/[id]/finalize/route.ts`
4. `app/api/invoices/[id]/finalize/route.ts`
5. `app/api/invoices/route.ts`

---

## Behavior: Dual-Mode Support

### Mode 1: Warehouse Disabled (Legacy)
- **`location_id`**: Optional (can be NULL)
- **Stock Update**: Uses `items.current_stock` (global stock)
- **Behavior**: Legacy single-warehouse behavior preserved
- **No validation**: No error if `location_id` is missing

### Mode 2: Warehouse Enabled (New)
- **`location_id`**: **MANDATORY** (returns 400 if missing)
- **Stock Update**: Uses `location_stock` (warehouse-scoped)
- **Behavior**: Multi-warehouse tracking enforced
- **Validation**: Fails loudly if `location_id` is missing

---

## Implementation Details

### Helper Function
**File**: `lib/warehouse-mode.ts`
```typescript
export async function isWarehouseModeEnabled(businessId: string): Promise<boolean>
```
- Checks `business_settings.warehouses_enabled`
- Returns `false` if column doesn't exist (backward compatible)
- Defaults to `false` on error (safe fallback)

### Conditional Logic Pattern
```typescript
// Check warehouse mode
const { isWarehouseModeEnabled } = await import('@/lib/warehouse-mode');
const warehouseModeEnabled = await isWarehouseModeEnabled(business_id);

// Validate location_id ONLY when warehouse mode enabled
if (warehouseModeEnabled && !item.location_id) {
  return NextResponse.json(
    { error: 'location_id (warehouse) is required...', code: 'WAREHOUSE_REQUIRED' },
    { status: 400 }
  );
}

// Conditional stock update
if (warehouseModeEnabled && locationId) {
  // Update location_stock
} else if (!warehouseModeEnabled) {
  // Update items.current_stock (legacy)
}
```

---

## Before vs After

### Before (Silent Fallback)
```typescript
const locationId = item.location_id || null;
if (locationId) {
  // Update location_stock
} else {
  // Silent fallback to global stock
  await client.query(`UPDATE items SET current_stock = ...`);
}
```
**Problem**: Always falls back silently, even when warehouse mode is enabled.

### After (Dual-Mode)
```typescript
const warehouseModeEnabled = await isWarehouseModeEnabled(business_id);

if (warehouseModeEnabled && !item.location_id) {
  return 400 error; // Fail loudly
}

if (warehouseModeEnabled && locationId) {
  // Update location_stock
} else if (!warehouseModeEnabled) {
  // Update items.current_stock (legacy mode)
}
```
**Solution**: 
- Warehouse mode ON → Requires `location_id`, uses `location_stock`
- Warehouse mode OFF → Allows NULL `location_id`, uses `items.current_stock`

---

## Error Response (Warehouse Mode Enabled)

```json
{
  "error": "location_id (warehouse) is required for item \"Item Name\". Warehouse mode is enabled - stock operations require warehouse context.",
  "item_id": "...",
  "item_name": "...",
  "code": "WAREHOUSE_REQUIRED"
}
```
**Status**: 400 Bad Request

---

## Impact

### ✅ Backward Compatibility
- Legacy businesses (warehouse disabled) continue to work
- No breaking changes for existing single-warehouse setups
- Global stock updates still work when warehouse mode is OFF

### ✅ Warehouse Mode Enforcement
- Warehouse-enabled businesses MUST provide `location_id`
- No silent fallbacks when warehouse mode is ON
- Prevents stock corruption in multi-warehouse scenarios

### ✅ Clear Error Messages
- Users know exactly what's missing
- Error code `WAREHOUSE_REQUIRED` for programmatic handling
- Includes item context for debugging

---

## Next Steps

Ready for **Step 2**: Add missing schema (`purchase_items.location_id`)
