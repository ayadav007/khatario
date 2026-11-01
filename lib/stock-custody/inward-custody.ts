import type { PoolClient } from 'pg';
import { GodownStockError, resolveGodown } from '@/lib/inventory/godown-stock';

/**
 * Register of goods in our godown that belong to someone else: a customer's machine in for
 * repair, goods kept for a party, goods sold but not yet collected. They are never our stock;
 * the register tells a count how much on the shelf to leave out.
 */
export const INWARD_REASONS = ['repair', 'job_work', 'storage', 'sold_not_collected', 'other'] as const;
type Queryable = Pick<PoolClient, 'query'>;
const q3 = (n: unknown) => Math.round((Number(n) || 0) * 1000) / 1000;

export interface InwardCustodyInput {
  warehouseId?: string | null;
  branchId?: string | null;
  ownerType?: 'customer' | 'supplier' | 'other';
  ownerId?: string | null;
  ownerName?: string | null;
  itemId?: string | null;
  description?: string | null;
  unit?: string | null;
  qty: number;
  receivedDate: string;
  reason?: (typeof INWARD_REASONS)[number];
  reference?: string | null;
  notes?: string | null;
}

export async function receiveOthersGoods(client: PoolClient, businessId: string, input: InwardCustodyInput, userId: string | null): Promise<string> {
  const qty = q3(input.qty);
  if (qty <= 0) throw new GodownStockError('Quantity must be more than zero');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.receivedDate || '')) throw new GodownStockError('Date received is required');
  const reason = INWARD_REASONS.includes(input.reason as any) ? input.reason! : 'repair';
  const godown = await resolveGodown(client, businessId, { warehouseId: input.warehouseId, branchId: input.branchId });
  const ownerType = input.ownerType === 'supplier' || input.ownerType === 'other' ? input.ownerType : 'customer';
  let ownerName = String(input.ownerName || '').trim();
  if (input.ownerId && ownerType !== 'other') {
    const o = await client.query(`SELECT name FROM ${ownerType === 'customer' ? 'customers' : 'suppliers'} WHERE id = $1 AND business_id = $2`, [input.ownerId, businessId]);
    if (!o.rows[0]) throw new GodownStockError('Owner not found', 404);
    ownerName = o.rows[0].name;
  }
  if (!ownerName) throw new GodownStockError('Whose goods are these?');
  let description = String(input.description || '').trim();
  if (input.itemId) {
    const i = await client.query(`SELECT name, unit FROM items WHERE id = $1 AND business_id = $2`, [input.itemId, businessId]);
    if (!i.rows[0]) throw new GodownStockError('Item not found', 404);
    description = description || i.rows[0].name;
  }
  if (!description) throw new GodownStockError('Describe the goods');
  const r = await client.query(
    `INSERT INTO inward_custody (business_id, warehouse_id, branch_id, owner_type, owner_id, owner_name, item_id, description, unit, qty,
       received_date, reason, reference, notes, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING id`,
    [businessId, godown.warehouseId, godown.branchId, ownerType, ownerType === 'other' ? null : input.ownerId || null, ownerName,
     input.itemId || null, description, input.unit || 'PCS', qty, input.receivedDate, reason, input.reference || null, input.notes || null, userId]
  );
  return r.rows[0].id;
}

/** Hands goods back to their owner, in part or in full. */
export async function returnOthersGoods(client: PoolClient, businessId: string, id: string, input: { qty: number; date: string }): Promise<{ status: string }> {
  const r = await client.query(`SELECT *, received_date::text AS received_on FROM inward_custody WHERE id = $1 AND business_id = $2 FOR UPDATE`, [id, businessId]);
  const row = r.rows[0];
  if (!row) throw new GodownStockError('Entry not found', 404);
  if (row.status !== 'held') throw new GodownStockError('These goods have already gone back.', 409);
  const qty = q3(input.qty);
  const open = q3(Number(row.qty) - Number(row.qty_returned));
  if (qty <= 0 || qty > open) throw new GodownStockError(`Return between 0 and ${open}.`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date || '') || input.date < row.received_on) {
    throw new GodownStockError('Return date must be on or after the date received');
  }
  const status = q3(open - qty) <= 0 ? 'returned' : 'held';
  await client.query(
    `UPDATE inward_custody SET qty_returned = qty_returned + $2, returned_date = $3, status = $4 WHERE id = $1`,
    [id, qty, input.date, status]
  );
  return { status };
}

export interface OthersGoodsRow {
  id: string;
  owner_name: string;
  owner_type: string;
  item_id: string | null;
  description: string;
  unit: string;
  qty: number;
  received_date: string;
  days_held: number;
  reason: string;
  reference: string | null;
  warehouse_id: string | null;
  warehouse_name: string | null;
}

export async function othersGoodsHeld(db: Queryable, businessId: string, opts: { warehouseId?: string | null; branchId?: string | null } = {}): Promise<OthersGoodsRow[]> {
  const r = await db.query(
    `SELECT c.id, c.owner_name, c.owner_type, c.item_id, c.description, c.unit, (c.qty - c.qty_returned)::float AS qty,
            c.received_date::text, (CURRENT_DATE - c.received_date) AS days_held, c.reason, c.reference,
            c.warehouse_id, w.name AS warehouse_name
       FROM inward_custody c LEFT JOIN warehouses w ON w.id = c.warehouse_id
      WHERE c.business_id = $1 AND c.status = 'held'
        AND ($2::uuid IS NULL OR c.warehouse_id = $2)
        AND ($3::uuid IS NULL OR (c.warehouse_id IS NULL AND c.branch_id = $3))
      ORDER BY c.received_date, c.owner_name`,
    [businessId, opts.warehouseId ?? null, opts.branchId ?? null]
  );
  return r.rows.map((x: any) => ({ ...x, days_held: Number(x.days_held) || 0 }));
}
