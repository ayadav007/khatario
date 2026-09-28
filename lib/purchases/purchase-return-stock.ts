import type { PoolClient } from 'pg';
import { adjustBranchItemStock, refreshItemGlobalStockFromBranches } from '@/lib/branch-stock';

/**
 * Moves stock for a purchase-return line. `direction: 'out'` sends goods back to the supplier;
 * `'in'` restores them when the return is cancelled. Services are ignored.
 */
export async function movePurchaseReturnStock(
  client: PoolClient,
  p: {
    businessId: string;
    branchId: string;
    warehouseId: string | null;
    itemId: string;
    qty: number;
    direction: 'out' | 'in';
    returnId: string;
    referenceType: 'purchase_return' | 'purchase_return_cancel';
    notes: string;
  }
): Promise<void> {
  const typeRes = await client.query(`SELECT item_type FROM items WHERE id = $1 AND business_id = $2`, [
    p.itemId,
    p.businessId,
  ]);
  if ((typeRes.rows[0]?.item_type || 'goods') !== 'goods' || !(p.qty > 0)) return;

  const signed = p.direction === 'out' ? -p.qty : p.qty;
  if (p.warehouseId) {
    await client.query(
      `INSERT INTO location_stock (location_id, item_id, current_stock_qty)
       VALUES ($1, $2, $3)
       ON CONFLICT (location_id, item_id)
       DO UPDATE SET current_stock_qty = location_stock.current_stock_qty + $3, last_updated = CURRENT_TIMESTAMP`,
      [p.warehouseId, p.itemId, signed]
    );
  } else {
    await adjustBranchItemStock(client, p.businessId, p.branchId, p.itemId, signed);
    await refreshItemGlobalStockFromBranches(client, p.businessId, p.itemId);
  }

  await client.query(
    `INSERT INTO stock_movements (business_id, item_id, type, quantity, reference_type, reference_id, location_id, notes)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [p.businessId, p.itemId, p.direction, p.qty, p.referenceType, p.returnId, p.warehouseId, p.notes]
  );
}
