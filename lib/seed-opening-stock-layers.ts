/**
 * After creating an item (or variant) with opening quantity, mirror that quantity into the
 * canonical layer: branch_item_stock / branch_item_variant_stock, or location_stock when
 * warehouse mode is on. stock_movements rows may still exist for audit; selling uses
 * branch/warehouse tables (see lib/branch-stock.ts, invoice stock checks).
 */

import { query } from '@/lib/db';
import { getDefaultBranchId } from '@/lib/branch-helpers';
import { isWarehouseModeEnabled } from '@/lib/warehouse-mode';
import {
  adjustBranchItemStock,
  refreshItemGlobalStockFromBranches,
  type BranchStockClient,
} from '@/lib/branch-stock';
import {
  adjustBranchVariantStock,
  refreshVariantGlobalStockFromBranches,
} from '@/lib/branch-variant-stock';

const stockClient: BranchStockClient = {
  query: ((text: string, params?: unknown[]) =>
    query(text, params as never[])) as BranchStockClient['query'],
};

export async function seedOpeningStockLayers(
  businessId: string,
  options: { itemId: string; quantity: number; variantId?: string | null }
): Promise<void> {
  const { itemId, quantity, variantId } = options;
  if (quantity <= 0) return;

  const defaultBranchId = await getDefaultBranchId(businessId);
  if (!defaultBranchId) {
    console.warn('[seedOpeningStockLayers] No default branch; skipping branch/warehouse seed', {
      businessId,
      itemId,
    });
    return;
  }

  const warehouseMode = await isWarehouseModeEnabled(businessId);

  if (variantId) {
    if (warehouseMode) {
      // Variant + warehouse: invoice stock resolution is item/warehouse-centric; skip here to
      // avoid inconsistent rows until a single variant location model is enforced in create.
      return;
    }
    await adjustBranchVariantStock(
      stockClient,
      businessId,
      defaultBranchId,
      variantId,
      quantity
    );
    await refreshVariantGlobalStockFromBranches(stockClient, businessId, variantId);
    return;
  }

  if (warehouseMode) {
    const { getDefaultWarehouseForBranch } = await import('@/lib/warehouse-access');
    const warehouseId = await getDefaultWarehouseForBranch(defaultBranchId);
    if (!warehouseId) {
      console.warn('[seedOpeningStockLayers] Warehouse mode but no default warehouse for branch', {
        defaultBranchId,
        businessId,
      });
      return;
    }
    await query(
      `INSERT INTO location_stock (location_id, item_id, current_stock_qty, last_updated)
       VALUES ($1, $2, $3, CURRENT_TIMESTAMP)
       ON CONFLICT (location_id, item_id) DO UPDATE SET
         current_stock_qty = location_stock.current_stock_qty + EXCLUDED.current_stock_qty,
         last_updated = CURRENT_TIMESTAMP`,
      [warehouseId, itemId, quantity]
    );
    return;
  }

  await adjustBranchItemStock(stockClient, businessId, defaultBranchId, itemId, quantity);
  await refreshItemGlobalStockFromBranches(stockClient, businessId, itemId);
}
