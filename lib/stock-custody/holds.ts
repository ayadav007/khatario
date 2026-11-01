import type { PoolClient } from 'pg';
import { changeGodownStock, GodownStockError, resolveGodown, type Godown } from '@/lib/inventory/godown-stock';
import { createQuantityAdjustmentOn, type ReasonCode } from '@/lib/inventory-adjustment-service';

/**
 * Stock that is in the godown but cannot be sold: quarantine, QC hold, damaged awaiting a
 * decision, customer returns awaiting inspection. Holding moves the quantity off the saleable
 * godown stock (an 'out' movement tagged held); it is still on the shelf, so a physical count
 * expects it. Releasing puts it back; writing off releases it and adjusts it out.
 */
export const HOLD_PURPOSES = ['quarantine', 'qc_hold', 'damaged', 'return_inspection'] as const;
export type HoldPurpose = (typeof HOLD_PURPOSES)[number];

type Queryable = Pick<PoolClient, 'query'>;
const q3 = (n: unknown) => Math.round((Number(n) || 0) * 1000) / 1000;

async function movement(
  client: PoolClient,
  p: { businessId: string; holdId: string; itemId: string; godown: Godown; type: 'in' | 'out'; qty: number; purpose: HoldPurpose; note: string; userId: string | null }
) {
  await client.query(
    `INSERT INTO stock_movements (
       business_id, item_id, location_id, type, quantity, reference_type, reference_id, notes, created_by,
       custody_status, custody_purpose
     ) VALUES ($1, $2, $3, $4, $5, 'stock_hold', $6, $7, $8, 'held', $9)`,
    [p.businessId, p.itemId, p.godown.warehouseId, p.type, p.qty, p.holdId, p.note, p.userId, p.purpose]
  );
}

export async function holdStock(
  client: PoolClient,
  businessId: string,
  input: { warehouseId?: string | null; branchId?: string | null; itemId: string; qty: number; purpose: HoldPurpose; date: string; reference?: string | null; notes?: string | null },
  userId: string | null
): Promise<string> {
  if (!HOLD_PURPOSES.includes(input.purpose)) throw new GodownStockError('Choose why the stock is held');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date || '')) throw new GodownStockError('Date is required');
  const qty = q3(input.qty);
  if (qty <= 0) throw new GodownStockError('Quantity must be more than zero');
  const item = await client.query(`SELECT id, name FROM items WHERE id = $1 AND business_id = $2`, [input.itemId, businessId]);
  if (!item.rows[0]) throw new GodownStockError('Item not found', 404);
  const godown = await resolveGodown(client, businessId, { warehouseId: input.warehouseId, branchId: input.branchId });

  await client.query(`SELECT pg_advisory_xact_lock(hashtext('stock_hold:' || $1::text))`, [businessId]);
  const n = await client.query(`SELECT COUNT(*)::int + 1 AS n FROM stock_holds WHERE business_id = $1`, [businessId]);
  const ins = await client.query(
    `INSERT INTO stock_holds (business_id, hold_number, warehouse_id, branch_id, item_id, purpose, hold_date, qty, reference, notes, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING id`,
    [businessId, `HOLD-${String(n.rows[0].n).padStart(4, '0')}`, godown.warehouseId, godown.branchId, input.itemId, input.purpose, input.date, qty, input.reference || null, input.notes || null, userId]
  );
  const id = ins.rows[0].id;
  await changeGodownStock(client, businessId, godown, input.itemId, -qty);
  await movement(client, { businessId, holdId: id, itemId: input.itemId, godown, type: 'out', qty, purpose: input.purpose, note: `Held: ${input.purpose.replace('_', ' ')}`, userId });
  return id;
}

/** Releases held stock back to saleable, writes some of it off, or both. */
export async function settleHold(
  client: PoolClient,
  businessId: string,
  holdId: string,
  input: { date: string; release?: number; writeOff?: number; reason?: ReasonCode; notes?: string | null },
  userId: string | null
): Promise<{ closed: boolean; adjustmentId: string | null }> {
  const r = await client.query(`SELECT * FROM stock_holds WHERE id = $1 AND business_id = $2 FOR UPDATE`, [holdId, businessId]);
  const hold = r.rows[0];
  if (!hold) throw new GodownStockError('Hold not found', 404);
  if (hold.status !== 'open') throw new GodownStockError('This hold is already closed.', 409);
  const release = q3(input.release);
  const writeOff = q3(input.writeOff);
  if (release < 0 || writeOff < 0 || release + writeOff <= 0) throw new GodownStockError('Enter what is released or written off');
  const open = q3(Number(hold.qty) - Number(hold.qty_released) - Number(hold.qty_written_off));
  if (release + writeOff > open) throw new GodownStockError(`Only ${open} is still held.`, 409);
  const godown: Godown = { warehouseMode: !!hold.warehouse_id, warehouseId: hold.warehouse_id, branchId: hold.branch_id };
  const total = q3(release + writeOff);

  await changeGodownStock(client, businessId, godown, hold.item_id, total);
  await movement(client, { businessId, holdId, itemId: hold.item_id, godown, type: 'in', qty: total, purpose: hold.purpose, note: `Hold ${hold.hold_number}: ${release} released, ${writeOff} written off`, userId });
  let adjustmentId: string | null = null;
  if (writeOff > 0) {
    const adj = await createQuantityAdjustmentOn(client, {
      businessId,
      itemId: hold.item_id,
      locationId: godown.warehouseId,
      branchId: godown.branchId,
      direction: 'DECREASE',
      quantity: writeOff,
      reasonCode: input.reason ?? 'DAMAGE',
      reasonNotes: `Written off from hold ${hold.hold_number}${input.notes ? `: ${input.notes}` : ''}`,
      adjustmentDate: input.date,
      createdBy: userId ?? undefined,
    });
    adjustmentId = adj.adjustmentId;
  }
  const closed = q3(open - total) <= 0;
  await client.query(
    `UPDATE stock_holds SET qty_released = qty_released + $2, qty_written_off = qty_written_off + $3,
            status = CASE WHEN $4 THEN 'closed' ELSE status END, closed_at = CASE WHEN $4 THEN NOW() ELSE closed_at END
      WHERE id = $1`,
    [holdId, release, writeOff, closed]
  );
  return { closed, adjustmentId };
}

export interface HeldRow {
  hold_id: string;
  hold_number: string;
  item_id: string;
  item_name: string;
  purpose: HoldPurpose;
  hold_date: string;
  qty: number;
  warehouse_id: string | null;
  warehouse_name: string | null;
  reference: string | null;
}

/** Open holds, optionally for one godown (warehouse, or branch in branch mode). */
export async function heldBalances(db: Queryable, businessId: string, opts: { warehouseId?: string | null; branchId?: string | null } = {}): Promise<HeldRow[]> {
  const r = await db.query(
    `SELECT h.id AS hold_id, h.hold_number, h.item_id, i.name AS item_name, h.purpose, h.hold_date::text,
            (h.qty - h.qty_released - h.qty_written_off)::float AS qty, h.warehouse_id, w.name AS warehouse_name, h.reference
       FROM stock_holds h JOIN items i ON i.id = h.item_id LEFT JOIN warehouses w ON w.id = h.warehouse_id
      WHERE h.business_id = $1 AND h.status = 'open'
        AND ($2::uuid IS NULL OR h.warehouse_id = $2)
        AND ($3::uuid IS NULL OR (h.warehouse_id IS NULL AND h.branch_id = $3))
      ORDER BY h.hold_date, h.hold_number`,
    [businessId, opts.warehouseId ?? null, opts.branchId ?? null]
  );
  return r.rows;
}
