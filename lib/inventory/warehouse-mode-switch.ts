import type { PoolClient } from 'pg';

export interface WarehouseSwitchResult {
  moved: Array<{ branch_id: string; warehouse_id: string; items: number; quantity: number }>;
  skippedExisting: number;
}

export class WarehouseSwitchError extends Error {
  constructor(
    message: string,
    public code: string,
    public details?: unknown
  ) {
    super(message);
  }
}

/** Default warehouse of a branch: the primary branch_warehouses link, else any linked/owned active warehouse. */
export async function defaultWarehouseForBranch(client: PoolClient, branchId: string): Promise<string | null> {
  const res = await client.query<{ id: string }>(
    `SELECT w.id
       FROM warehouses w
       LEFT JOIN branch_warehouses bw ON bw.warehouse_id = w.id AND bw.branch_id = $1
      WHERE COALESCE(w.is_active, true) = true
        AND (bw.branch_id IS NOT NULL OR w.branch_id = $1)
      ORDER BY COALESCE(bw.is_primary, false) DESC, w.created_at ASC
      LIMIT 1`,
    [branchId]
  );
  return res.rows[0]?.id ?? null;
}

/**
 * Turning warehouse mode on: each branch's stock (branch_item_stock) moves into that branch's
 * default warehouse. Items that already have warehouse stock in the branch are left alone, so
 * re-running never double-counts. Fails if a branch holds stock but has no warehouse.
 */
export async function moveBranchStockIntoWarehouses(
  client: PoolClient,
  businessId: string
): Promise<WarehouseSwitchResult> {
  const branches = await client.query<{ branch_id: string; name: string }>(
    `SELECT bis.branch_id, br.name
       FROM branch_item_stock bis
       JOIN branches br ON br.id = bis.branch_id
       JOIN items i ON i.id = bis.item_id AND i.deleted_at IS NULL AND COALESCE(i.item_type, 'goods') = 'goods'
      WHERE bis.business_id = $1 AND bis.quantity <> 0
      GROUP BY bis.branch_id, br.name`,
    [businessId]
  );

  const targets = new Map<string, string>();
  const missing: string[] = [];
  for (const b of branches.rows) {
    const wh = await defaultWarehouseForBranch(client, b.branch_id);
    if (wh) targets.set(b.branch_id, wh);
    else missing.push(b.name);
  }
  if (missing.length > 0) {
    throw new WarehouseSwitchError(
      `Create a warehouse for ${missing.join(', ')} before turning on warehouse mode; those branches hold stock.`,
      'BRANCH_WITHOUT_WAREHOUSE',
      { branches: missing }
    );
  }

  const result: WarehouseSwitchResult = { moved: [], skippedExisting: 0 };
  for (const [branchId, warehouseId] of targets) {
    await moveOneBranchStock(client, businessId, branchId, warehouseId, result);
  }
  return result;
}

export async function moveOneBranchStock(
  client: PoolClient,
  businessId: string,
  branchId: string,
  warehouseId: string,
  result: WarehouseSwitchResult = { moved: [], skippedExisting: 0 }
): Promise<WarehouseSwitchResult> {
  {
    const stock = await client.query<{ item_id: string; quantity: string }>(
      `SELECT bis.item_id, bis.quantity::text
         FROM branch_item_stock bis
         JOIN items i ON i.id = bis.item_id AND i.deleted_at IS NULL AND COALESCE(i.item_type, 'goods') = 'goods'
        WHERE bis.business_id = $1 AND bis.branch_id = $2 AND bis.quantity <> 0`,
      [businessId, branchId]
    );
    let items = 0;
    let quantity = 0;
    for (const row of stock.rows) {
      const already = await client.query(
        `SELECT 1
           FROM location_stock ls
           JOIN warehouses w ON w.id = ls.location_id
           LEFT JOIN branch_warehouses bw ON bw.warehouse_id = w.id AND bw.branch_id = $2
          WHERE ls.item_id = $1 AND ls.current_stock_qty <> 0
            AND (bw.branch_id IS NOT NULL OR w.branch_id = $2)
          LIMIT 1`,
        [row.item_id, branchId]
      );
      if (already.rows.length > 0) {
        result.skippedExisting++;
        continue;
      }
      const qty = Number(row.quantity);
      const upd = await client.query(
        `UPDATE location_stock SET current_stock_qty = $3, last_updated = CURRENT_TIMESTAMP
          WHERE location_id = $1 AND item_id = $2`,
        [warehouseId, row.item_id, qty]
      );
      if (!upd.rowCount) {
        await client.query(
          `INSERT INTO location_stock (location_id, item_id, current_stock_qty, min_stock_qty)
           VALUES ($1, $2, $3, 0)`,
          [warehouseId, row.item_id, qty]
        );
      }
      items++;
      quantity += qty;
    }
    result.moved.push({ branch_id: branchId, warehouse_id: warehouseId, items, quantity });
  }
  return result;
}

/** Branch that owns a warehouse (primary branch_warehouses link, else warehouses.branch_id). */
export async function branchOfWarehouse(client: PoolClient, warehouseId: string): Promise<string | null> {
  const res = await client.query<{ branch_id: string | null }>(
    `SELECT COALESCE(
       (SELECT bw.branch_id FROM branch_warehouses bw WHERE bw.warehouse_id = w.id
         ORDER BY bw.is_primary DESC NULLS LAST LIMIT 1),
       w.branch_id) AS branch_id
       FROM warehouses w WHERE w.id = $1`,
    [warehouseId]
  );
  return res.rows[0]?.branch_id ?? null;
}

/**
 * Turning warehouse mode off: each branch's stock becomes the sum of its warehouses, and the
 * item total becomes the sum over branches, so branch mode starts from the true quantities.
 */
export async function rollWarehouseStockIntoBranches(client: PoolClient, businessId: string): Promise<number> {
  const res = await client.query<{ branch_id: string; item_id: string; qty: string }>(
    `SELECT COALESCE(bw.branch_id, w.branch_id, def.id) AS branch_id, ls.item_id, SUM(ls.current_stock_qty)::text AS qty
       FROM location_stock ls
       JOIN warehouses w ON w.id = ls.location_id AND w.business_id = $1
       LEFT JOIN LATERAL (
         SELECT b.branch_id FROM branch_warehouses b
          WHERE b.warehouse_id = w.id
          ORDER BY b.is_primary DESC NULLS LAST
          LIMIT 1
       ) bw ON true
       LEFT JOIN LATERAL (
         SELECT id FROM branches
          WHERE business_id = $1 AND COALESCE(is_active, true) = true
          ORDER BY COALESCE(is_default, false) DESC, created_at ASC
          LIMIT 1
       ) def ON true
      WHERE COALESCE(bw.branch_id, w.branch_id, def.id) IS NOT NULL
      GROUP BY 1, 2`,
    [businessId]
  );
  for (const r of res.rows) {
    await client.query(
      `INSERT INTO branch_item_stock (business_id, branch_id, item_id, quantity)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (business_id, branch_id, item_id)
       DO UPDATE SET quantity = EXCLUDED.quantity, updated_at = CURRENT_TIMESTAMP`,
      [businessId, r.branch_id, r.item_id, Number(r.qty)]
    );
  }
  await client.query(
    `UPDATE items i
        SET current_stock = s.total
       FROM (
         SELECT item_id, SUM(quantity) AS total FROM branch_item_stock WHERE business_id = $1 GROUP BY item_id
       ) s
      WHERE i.id = s.item_id AND i.business_id = $1`,
    [businessId]
  );
  // Branch stock is now the record; stale warehouse rows would be skipped on the next switch-on.
  await client.query(
    `UPDATE location_stock ls SET current_stock_qty = 0, last_updated = CURRENT_TIMESTAMP
       FROM warehouses w
      WHERE w.id = ls.location_id AND w.business_id = $1 AND ls.current_stock_qty <> 0`,
    [businessId]
  );
  return res.rows.length;
}
