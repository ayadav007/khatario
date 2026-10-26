import type { PoolClient } from 'pg';
import { changeGodownStock, GodownStockError, type Godown } from '@/lib/inventory/godown-stock';

/**
 * Goods billed by the supplier but not yet in the godown. The bill posts stock, cost and ITC as
 * usual (the goods are ours once billed); this then moves the quantity out of the godown into
 * "in transit from supplier" so a count of the godown does not show them as missing. Receiving
 * brings them back. Movements use reference_type 'purchase_transit' so cancelling the bill,
 * which reverses the 'purchase' movements, does not mistake them for the bill's own stock.
 */

const q3 = (n: unknown) => Math.round((Number(n) || 0) * 1000) / 1000;

async function godownFor(
  client: PoolClient,
  businessId: string,
  branchId: string | null,
  locationId: string | null
): Promise<Godown> {
  if (locationId) return { warehouseMode: true, warehouseId: locationId, branchId };
  if (!branchId) throw new GodownStockError('The bill has no branch to hold its stock.');
  return { warehouseMode: false, warehouseId: null, branchId };
}

async function lockPurchase(client: PoolClient, businessId: string, purchaseId: string) {
  const r = await client.query(
    `SELECT id, bill_number, bill_date::text, status, goods_status, supplier_id, branch_id
       FROM purchases WHERE id = $1 AND business_id = $2 FOR UPDATE`,
    [purchaseId, businessId]
  );
  if (!r.rows[0]) throw new GodownStockError('Purchase not found', 404);
  return r.rows[0];
}

async function custodyMove(
  client: PoolClient,
  p: { businessId: string; purchase: any; itemId: string; locationId: string | null; type: 'in' | 'out'; qty: number; note: string; userId: string | null }
) {
  await client.query(
    `INSERT INTO stock_movements (
       business_id, item_id, location_id, type, quantity, reference_type, reference_id, notes, created_by,
       custody_status, custody_purpose, custody_party_type, custody_party_id
     ) VALUES ($1, $2, $3, $4, $5, 'purchase_transit', $6, $7, $8, 'in_transit', 'inward', $9, $10)`,
    [
      p.businessId, p.itemId, p.locationId, p.type, p.qty, p.purchase.id, p.note, p.userId,
      p.purchase.supplier_id ? 'supplier' : null, p.purchase.supplier_id,
    ]
  );
}

/**
 * Marks a final bill's goods as not yet received. Runs right after the bill posted its stock,
 * on the same transaction. Batch- and serial-tracked lines must be received with the bill.
 */
export async function holdPurchaseInTransit(
  client: PoolClient,
  businessId: string,
  purchaseId: string,
  userId: string | null
): Promise<number> {
  const purchase = await lockPurchase(client, businessId, purchaseId);
  if (purchase.status !== 'final') throw new GodownStockError('Only a final bill can be marked as in transit.', 409);
  if (purchase.goods_status !== 'received') throw new GodownStockError('This bill is already marked as in transit.', 409);

  const lines = await client.query(
    `SELECT pi.id, pi.item_id, pi.location_id, i.name, i.track_batch, i.track_serial,
            (pi.quantity + COALESCE(pi.free_qty, 0))::float AS qty
       FROM purchase_items pi JOIN items i ON i.id = pi.item_id AND i.business_id = $2
      WHERE pi.purchase_id = $1 AND COALESCE(i.item_type, 'goods') = 'goods'
        AND COALESCE(pi.line_item_type, 'goods') <> 'service'
        AND pi.itc_type IS DISTINCT FROM 'capital_goods' AND pi.quantity > 0`,
    [purchaseId, businessId]
  );
  const tracked = lines.rows.find((l: any) => l.track_batch || l.track_serial);
  if (tracked) {
    throw new GodownStockError(`${tracked.name} is tracked by batch or serial; receive it with the bill.`, 409, 'TRACKED_LINE');
  }
  for (const l of lines.rows) {
    const godown = await godownFor(client, businessId, purchase.branch_id, l.location_id);
    await changeGodownStock(client, businessId, godown, l.item_id, -q3(l.qty));
    await custodyMove(client, {
      businessId, purchase, itemId: l.item_id, locationId: l.location_id, type: 'out', qty: q3(l.qty),
      note: `Bill ${purchase.bill_number || ''}: goods in transit from supplier`, userId,
    });
    await client.query(`UPDATE purchase_items SET qty_received = 0 WHERE id = $1`, [l.id]);
  }
  if (lines.rows.length) {
    await client.query(`UPDATE purchases SET goods_status = 'in_transit', updated_at = NOW() WHERE id = $1`, [purchaseId]);
  }
  return lines.rows.length;
}

/** Goods of an in-transit bill arriving at the godown, in full or in part. */
export async function receivePurchaseGoods(
  client: PoolClient,
  businessId: string,
  purchaseId: string,
  input: { date: string; lines: Array<{ purchase_item_id: string; qty: number }> },
  userId: string | null
): Promise<{ goods_status: string }> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date || '')) throw new GodownStockError('Receipt date is required');
  const purchase = await lockPurchase(client, businessId, purchaseId);
  if (purchase.status !== 'final' || purchase.goods_status === 'received') {
    throw new GodownStockError('This bill has no goods waiting to be received.', 409);
  }
  if (input.date < purchase.bill_date) throw new GodownStockError('Goods cannot arrive before the bill date.');
  const rows = await client.query(
    `SELECT pi.id, pi.item_id, pi.location_id, pi.item_name,
            (pi.quantity + COALESCE(pi.free_qty, 0))::float AS qty, COALESCE(pi.qty_received, 0)::float AS received
       FROM purchase_items pi WHERE pi.purchase_id = $1 AND pi.qty_received IS NOT NULL FOR UPDATE`,
    [purchaseId]
  );
  const byId = new Map(rows.rows.map((r: any) => [r.id, r]));
  for (const l of input.lines) {
    const row: any = byId.get(l.purchase_item_id);
    if (!row) throw new GodownStockError('Bill line not found', 404);
    const qty = q3(l.qty);
    if (qty <= 0) continue;
    const open = q3(row.qty - row.received);
    if (qty > open) throw new GodownStockError(`${row.item_name}: only ${open} is still in transit.`, 409);
    const godown = await godownFor(client, businessId, purchase.branch_id, row.location_id);
    await changeGodownStock(client, businessId, godown, row.item_id, qty);
    await custodyMove(client, {
      businessId, purchase, itemId: row.item_id, locationId: row.location_id, type: 'in', qty,
      note: `Bill ${purchase.bill_number || ''}: ${qty} received on ${input.date}`, userId,
    });
    await client.query(`UPDATE purchase_items SET qty_received = qty_received + $2 WHERE id = $1`, [row.id, qty]);
  }
  const left = await client.query(
    `SELECT COUNT(*) FILTER (WHERE qty_received < quantity + COALESCE(free_qty, 0))::int AS open,
            COUNT(*) FILTER (WHERE qty_received > 0)::int AS some
       FROM purchase_items WHERE purchase_id = $1 AND qty_received IS NOT NULL`,
    [purchaseId]
  );
  const goodsStatus = left.rows[0].open === 0 ? 'received' : left.rows[0].some > 0 ? 'partial' : 'in_transit';
  await client.query(`UPDATE purchases SET goods_status = $2, updated_at = NOW() WHERE id = $1`, [purchaseId, goodsStatus]);
  return { goods_status: goodsStatus };
}

/**
 * Before a bill is cancelled: brings goods still in transit back onto the godown so the
 * cancellation can reverse the bill's stock as usual.
 */
export async function releasePurchaseInTransit(client: PoolClient, businessId: string, purchaseId: string): Promise<void> {
  const purchase = await lockPurchase(client, businessId, purchaseId);
  if (purchase.goods_status === 'received') return;
  const open = await client.query(
    `SELECT id, (quantity + COALESCE(free_qty, 0) - qty_received)::float AS qty FROM purchase_items
      WHERE purchase_id = $1 AND qty_received IS NOT NULL AND qty_received < quantity + COALESCE(free_qty, 0)`,
    [purchaseId]
  );
  if (!open.rows.length) return;
  await receivePurchaseGoods(
    client,
    businessId,
    purchaseId,
    { date: purchase.bill_date, lines: open.rows.map((r: any) => ({ purchase_item_id: r.id, qty: r.qty })) },
    null
  );
}

export interface InwardTransitRow {
  item_id: string;
  item_name: string;
  stock_class: string;
  purchase_id: string;
  bill_number: string | null;
  bill_date: string;
  supplier_name: string | null;
  warehouse_id: string | null;
  branch_id: string | null;
  qty: number;
  days_in_transit: number;
  eway_bill_number: string | null;
  eway_bill_status: string | null;
}

/** Billed goods still on the way from suppliers, by the godown they are going to. */
export async function inwardTransitBalances(
  db: Pick<PoolClient, 'query'>,
  businessId: string,
  opts: { warehouseId?: string | null; branchId?: string | null; asOf?: Date } = {}
): Promise<InwardTransitRow[]> {
  const { effectiveEwayStatus } = await import('@/lib/gst/eway-bills');
  const now = opts.asOf ?? new Date();
  const r = await db.query(
    `WITH held AS (
       SELECT sm.item_id, sm.location_id, sm.reference_id AS purchase_id,
              -SUM(CASE sm.type WHEN 'in' THEN ABS(sm.quantity) WHEN 'out' THEN -ABS(sm.quantity) ELSE sm.quantity END) AS qty
         FROM stock_movements sm
        WHERE sm.business_id = $1 AND sm.custody_status = 'in_transit' AND sm.reference_type = 'purchase_transit'
          AND ($2::uuid IS NULL OR sm.location_id = $2)
        GROUP BY 1, 2, 3
     )
     SELECT h.item_id, i.name AS item_name, COALESCE(i.stock_class, 'trading') AS stock_class,
            p.id AS purchase_id, p.bill_number, p.bill_date::text, s.name AS supplier_name,
            h.location_id AS warehouse_id, p.branch_id, h.qty::float AS qty,
            eb.ewb_number AS eway_bill_number, eb.status AS eway_bill_status, eb.valid_until
       FROM held h
       JOIN items i ON i.id = h.item_id
       JOIN purchases p ON p.id = h.purchase_id AND p.business_id = $1 AND ($3::uuid IS NULL OR p.branch_id = $3)
       LEFT JOIN suppliers s ON s.id = p.supplier_id
       LEFT JOIN LATERAL (
         SELECT ewb_number, status, valid_until FROM eway_bills
          WHERE business_id = $1 AND source_type = 'purchase' AND source_id = p.id
          ORDER BY generated_at DESC LIMIT 1
       ) eb ON true
      WHERE h.qty > 0.0005
      ORDER BY p.bill_date, p.bill_number, i.name`,
    [businessId, opts.warehouseId ?? null, opts.branchId ?? null]
  );
  return r.rows.map((x: any) => ({
    ...x,
    days_in_transit: Math.max(0, Math.floor((now.getTime() - Date.parse(`${x.bill_date}T00:00:00+05:30`)) / 864e5)),
    eway_bill_status: x.eway_bill_number ? effectiveEwayStatus(x.eway_bill_status, x.valid_until, now) : null,
  }));
}
