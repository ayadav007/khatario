/**
 * Per-branch quantities for item_variants when warehouse mode is OFF.
 * When warehouse mode is ON, use location_stock at item level (variants share location bins).
 * item_variants.current_stock is refreshed as SUM(branch_item_variant_stock) for catalog display.
 */

import type { PoolClient } from 'pg';
import { queryOne } from '@/lib/db';

export interface BranchVariantStockClient {
  query: PoolClient['query'];
}

export async function getBranchVariantQuantity(
  client: BranchVariantStockClient,
  businessId: string,
  branchId: string,
  itemVariantId: string
): Promise<number> {
  const res = await client.query(
    `SELECT quantity FROM branch_item_variant_stock
     WHERE business_id = $1 AND branch_id = $2 AND item_variant_id = $3`,
    [businessId, branchId, itemVariantId]
  );
  if (res.rows.length === 0) return 0;
  return parseFloat(String(res.rows[0].quantity ?? 0)) || 0;
}

export async function adjustBranchVariantStock(
  client: BranchVariantStockClient,
  businessId: string,
  branchId: string,
  itemVariantId: string,
  delta: number
): Promise<number> {
  const res = await client.query(
    `INSERT INTO branch_item_variant_stock (business_id, branch_id, item_variant_id, quantity, created_at, updated_at)
     VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
     ON CONFLICT (business_id, branch_id, item_variant_id)
     DO UPDATE SET
       quantity = branch_item_variant_stock.quantity + EXCLUDED.quantity,
       updated_at = CURRENT_TIMESTAMP
     RETURNING quantity`,
    [businessId, branchId, itemVariantId, delta]
  );
  return parseFloat(String(res.rows[0]?.quantity ?? 0)) || 0;
}

export async function refreshVariantGlobalStockFromBranches(
  client: BranchVariantStockClient,
  businessId: string,
  itemVariantId: string
): Promise<void> {
  const sumRes = await client.query(
    `SELECT COALESCE(SUM(quantity), 0)::numeric AS total
     FROM branch_item_variant_stock
     WHERE business_id = $1 AND item_variant_id = $2`,
    [businessId, itemVariantId]
  );
  const total = parseFloat(String(sumRes.rows[0]?.total ?? 0)) || 0;
  await client.query(
    `UPDATE item_variants SET current_stock = $1, updated_at = CURRENT_TIMESTAMP
     WHERE id = $2`,
    [total, itemVariantId]
  );
}

export async function getBranchVariantQuantityDb(
  businessId: string,
  branchId: string,
  itemVariantId: string
): Promise<number> {
  const row = await queryOne<{ q: string }>(
    `SELECT COALESCE(quantity, 0)::text AS q FROM branch_item_variant_stock
     WHERE business_id = $1 AND branch_id = $2 AND item_variant_id = $3`,
    [businessId, branchId, itemVariantId]
  );
  return parseFloat(row?.q || '0') || 0;
}
