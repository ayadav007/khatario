/**
 * Branch-level inventory for businesses with warehouses_enabled = false.
 * When warehouse mode is on, use location_stock instead (see invoice / purchase routes).
 */

import type { PoolClient } from 'pg';
import { queryOne } from '@/lib/db';

export interface BranchStockClient {
  query: PoolClient['query'];
}

/**
 * Read quantity on branch_item_stock row (0 if missing).
 */
export async function getBranchItemQuantity(
  client: BranchStockClient,
  businessId: string,
  branchId: string,
  itemId: string
): Promise<number> {
  const res = await client.query(
    `SELECT quantity FROM branch_item_stock
     WHERE business_id = $1 AND branch_id = $2 AND item_id = $3`,
    [businessId, branchId, itemId]
  );
  if (res.rows.length === 0) return 0;
  return parseFloat(String(res.rows[0].quantity ?? 0)) || 0;
}

/**
 * Lock row for update (blocking).
 */
export async function lockBranchItemStock(
  client: BranchStockClient,
  businessId: string,
  branchId: string,
  itemId: string
): Promise<void> {
  await client.query(
    `SELECT 1 FROM branch_item_stock
     WHERE business_id = $1 AND branch_id = $2 AND item_id = $3
     FOR UPDATE`,
    [businessId, branchId, itemId]
  );
}

/**
 * Apply delta to branch stock (upsert). Caller must hold transaction + lock when racing.
 */
export async function adjustBranchItemStock(
  client: BranchStockClient,
  businessId: string,
  branchId: string,
  itemId: string,
  delta: number
): Promise<number> {
  const res = await client.query(
    `INSERT INTO branch_item_stock (business_id, branch_id, item_id, quantity, created_at, updated_at)
     VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
     ON CONFLICT (business_id, branch_id, item_id)
     DO UPDATE SET
       quantity = branch_item_stock.quantity + EXCLUDED.quantity,
       updated_at = CURRENT_TIMESTAMP
     RETURNING quantity`,
    [businessId, branchId, itemId, delta]
  );
  return parseFloat(String(res.rows[0]?.quantity ?? 0)) || 0;
}

/**
 * Keep items.current_stock equal to sum of branch rows for list/dashboard compatibility.
 */
export async function refreshItemGlobalStockFromBranches(
  client: BranchStockClient,
  businessId: string,
  itemId: string
): Promise<void> {
  const sumRes = await client.query(
    `SELECT COALESCE(SUM(quantity), 0)::numeric AS total
     FROM branch_item_stock
     WHERE business_id = $1 AND item_id = $2`,
    [businessId, itemId]
  );
  const total = parseFloat(String(sumRes.rows[0]?.total ?? 0)) || 0;
  await client.query(
    `UPDATE items SET current_stock = $1, updated_at = CURRENT_TIMESTAMP
     WHERE id = $2 AND business_id = $3`,
    [total, itemId, businessId]
  );
}

/** Read branch quantity outside an explicit transaction (pre-flight checks). */
export async function getBranchItemQuantityDb(
  businessId: string,
  branchId: string,
  itemId: string
): Promise<number> {
  const row = await queryOne<{ q: string }>(
    `SELECT COALESCE(quantity, 0)::text AS q FROM branch_item_stock
     WHERE business_id = $1 AND branch_id = $2 AND item_id = $3`,
    [businessId, branchId, itemId]
  );
  return parseFloat(row?.q || '0') || 0;
}
