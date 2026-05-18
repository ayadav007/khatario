/**
 * Legacy items often had items.current_stock (or item_variants.current_stock) set while
 * branch_item_stock / branch_item_variant_stock were never populated. Invoice checks use
 * per-branch rows only. When catalog total exceeds the sum of branch rows, apply the
 * shortfall to the branch used for this invoice so the sale matches catalog quantity.
 */

import { query, queryOne } from '@/lib/db';
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

/**
 * If items.current_stock (aggregate) is greater than SUM(branch_item_stock), add the
 * difference to `branchId` so this branch can fulfil the invoice.
 * @returns true if a row was adjusted
 */
export async function tryReconcileBaseItemBranchStock(
  businessId: string,
  itemId: string,
  branchId: string
): Promise<boolean> {
  if (await isWarehouseModeEnabled(businessId)) return false;

  const item = await queryOne<{
    current_stock: string;
    item_type: string;
    has_variants: boolean;
  }>(
    `SELECT current_stock::text, item_type, COALESCE(has_variants, false) AS has_variants
     FROM items WHERE id = $1 AND business_id = $2`,
    [itemId, businessId]
  );
  if (!item || item.item_type !== 'goods' || item.has_variants) return false;

  const catalog = parseFloat(String(item.current_stock ?? '0')) || 0;
  const sumRow = await queryOne<{ s: string }>(
    `SELECT COALESCE(SUM(quantity), 0)::text AS s
     FROM branch_item_stock
     WHERE business_id = $1 AND item_id = $2`,
    [businessId, itemId]
  );
  const branchSum = parseFloat(String(sumRow?.s ?? '0')) || 0;
  const delta = catalog - branchSum;
  if (delta <= 1e-9) return false;

  await adjustBranchItemStock(stockClient, businessId, branchId, itemId, delta);
  await refreshItemGlobalStockFromBranches(stockClient, businessId, itemId);
  return true;
}

/**
 * Same for variants: item_variants.current_stock vs SUM(branch_item_variant_stock).
 */
export async function tryReconcileVariantBranchStock(
  businessId: string,
  variantId: string,
  branchId: string
): Promise<boolean> {
  if (await isWarehouseModeEnabled(businessId)) return false;

  const row = await queryOne<{ current_stock: string }>(
    `SELECT iv.current_stock::text
     FROM item_variants iv
     JOIN items i ON i.id = iv.item_id
     WHERE iv.id = $1 AND i.business_id = $2`,
    [variantId, businessId]
  );
  if (!row) return false;

  const catalog = parseFloat(String(row.current_stock ?? '0')) || 0;
  const sumRow = await queryOne<{ s: string }>(
    `SELECT COALESCE(SUM(quantity), 0)::text AS s
     FROM branch_item_variant_stock
     WHERE business_id = $1 AND item_variant_id = $2`,
    [businessId, variantId]
  );
  const branchSum = parseFloat(String(sumRow?.s ?? '0')) || 0;
  const delta = catalog - branchSum;
  if (delta <= 1e-9) return false;

  await adjustBranchVariantStock(stockClient, businessId, branchId, variantId, delta);
  await refreshVariantGlobalStockFromBranches(stockClient, businessId, variantId);
  return true;
}
