import type { PoolClient } from 'pg';
import { isWarehouseModeEnabled } from '@/lib/warehouse-mode';
import { adjustBranchItemStock, refreshItemGlobalStockFromBranches } from '@/lib/branch-stock';

/**
 * The godown a quantity sits in: a warehouse when warehouse mode is on (location_stock),
 * otherwise a branch (branch_item_stock).
 */
export interface Godown {
  warehouseMode: boolean;
  warehouseId: string | null;
  branchId: string | null;
}

export class GodownStockError extends Error {
  constructor(message: string, readonly status = 400, readonly code = 'GODOWN_STOCK') {
    super(message);
  }
}

/** The stock_movements trigger refuses movements into a godown under count (migration 414). */
export function isStockFrozenError(error: unknown): boolean {
  return String((error as { message?: string })?.message ?? '').startsWith('STOCK_FROZEN:');
}

/** Error body for a refused stock change, or null when the error is something else. */
export function stockErrorBody(error: unknown): { body: { error: string; code: string }; status: number } | null {
  if (error instanceof GodownStockError) return { body: { error: error.message, code: error.code }, status: error.status };
  if (isStockFrozenError(error)) {
    return {
      body: { error: String((error as Error).message).replace(/^STOCK_FROZEN:\s*/, ''), code: 'STOCK_FROZEN' },
      status: 423,
    };
  }
  return null;
}

/** Resolves and checks the godown for a business; a warehouse must belong to it. */
export async function resolveGodown(
  client: Pick<PoolClient, 'query'>,
  businessId: string,
  ref: { warehouseId?: string | null; branchId?: string | null }
): Promise<Godown> {
  const warehouseMode = await isWarehouseModeEnabled(businessId);
  if (warehouseMode) {
    if (!ref.warehouseId) throw new GodownStockError('Choose the godown (warehouse) the goods leave from.');
    const w = await client.query(`SELECT id, branch_id FROM warehouses WHERE id = $1 AND business_id = $2`, [
      ref.warehouseId,
      businessId,
    ]);
    if (!w.rows[0]) throw new GodownStockError('Warehouse not found', 404);
    return { warehouseMode, warehouseId: w.rows[0].id, branchId: w.rows[0].branch_id ?? ref.branchId ?? null };
  }
  let branchId = ref.branchId ?? null;
  if (!branchId) {
    const b = await client.query(
      `SELECT id FROM branches WHERE business_id = $1 AND COALESCE(is_active, true)
        ORDER BY is_default DESC NULLS LAST, is_primary DESC NULLS LAST, created_at LIMIT 1`,
      [businessId]
    );
    branchId = b.rows[0]?.id ?? null;
  } else {
    const b = await client.query(`SELECT id FROM branches WHERE id = $1 AND business_id = $2`, [branchId, businessId]);
    if (!b.rows[0]) throw new GodownStockError('Branch not found', 404);
  }
  if (!branchId) throw new GodownStockError('This business has no branch to hold stock.');
  return { warehouseMode, warehouseId: null, branchId };
}

/** Quantities on hand in the godown, locked for update when `lock` is set. */
export async function godownQuantities(
  client: Pick<PoolClient, 'query'>,
  businessId: string,
  godown: Godown,
  itemIds: string[] | null,
  lock = false
): Promise<Map<string, number>> {
  const forUpdate = lock ? 'FOR UPDATE' : '';
  const res = godown.warehouseMode
    ? await client.query<{ item_id: string; qty: string }>(
        `SELECT ls.item_id, ls.current_stock_qty AS qty
           FROM location_stock ls
           JOIN items i ON i.id = ls.item_id AND i.business_id = $1
          WHERE ls.location_id = $2 AND ($3::uuid[] IS NULL OR ls.item_id = ANY($3::uuid[]))
          ${lock ? 'FOR UPDATE OF ls' : ''}`,
        [businessId, godown.warehouseId, itemIds]
      )
    : await client.query<{ item_id: string; qty: string }>(
        `SELECT item_id, quantity AS qty FROM branch_item_stock
          WHERE business_id = $1 AND branch_id = $2 AND ($3::uuid[] IS NULL OR item_id = ANY($3::uuid[]))
          ${forUpdate}`,
        [businessId, godown.branchId, itemIds]
      );
  return new Map(res.rows.map((r) => [r.item_id, Number(r.qty) || 0]));
}

/**
 * Adds `delta` to the godown's quantity and returns the new quantity. Refuses to go below zero.
 * The caller records the matching stock_movements row on the same transaction.
 */
export async function changeGodownStock(
  client: PoolClient,
  businessId: string,
  godown: Godown,
  itemId: string,
  delta: number
): Promise<number> {
  const current = (await godownQuantities(client, businessId, godown, [itemId], true)).get(itemId) ?? 0;
  const next = Math.round((current + delta) * 1000) / 1000;
  if (next < 0) {
    throw new GodownStockError(`Not enough stock in the godown. Available: ${current}, needed: ${-delta}`, 409, 'INSUFFICIENT_STOCK');
  }
  if (godown.warehouseMode) {
    await client.query(
      `INSERT INTO location_stock (location_id, item_id, current_stock_qty, last_updated)
       VALUES ($1, $2, $3, CURRENT_TIMESTAMP)
       ON CONFLICT (location_id, item_id)
       DO UPDATE SET current_stock_qty = EXCLUDED.current_stock_qty, last_updated = CURRENT_TIMESTAMP`,
      [godown.warehouseId, itemId, next]
    );
  } else {
    await adjustBranchItemStock(client, businessId, godown.branchId as string, itemId, delta);
    await refreshItemGlobalStockFromBranches(client, businessId, itemId);
  }
  return next;
}
