import type { PoolClient } from 'pg';
import { changeGodownStock, GodownStockError, resolveGodown, type Godown } from '@/lib/inventory/godown-stock';
import { createQuantityAdjustmentOn, type ReasonCode } from '@/lib/inventory-adjustment-service';
import { effectiveEwayStatus } from '@/lib/gst/eway-bills';

/**
 * Stock that has left the godown but is still ours. A returnable challan's dispatch is an 'out'
 * movement tagged with_third_party + purpose + party; each return is an 'in' movement with the
 * same tags. What a party holds = -SUM(signed qty) of its tagged movements.
 */
export const CUSTODY_PURPOSES = ['repair', 'job_work', 'approval', 'consignment', 'exhibition', 'demo', 'other'] as const;
export type CustodyPurpose = (typeof CUSTODY_PURPOSES)[number];

export const CHALLAN_KINDS = ['supply', 'returnable', 'non_returnable'] as const;
export type ChallanKind = (typeof CHALLAN_KINDS)[number];

/** Inputs sent to a job worker must come back within 1 year, capital goods within 3 (s.143). */
export const JOB_WORK_RETURN_YEARS = { inputs: 1, capital_goods: 3 } as const;

export function parseCustodyPurpose(value: unknown): CustodyPurpose | null {
  return CUSTODY_PURPOSES.includes(value as CustodyPurpose) ? (value as CustodyPurpose) : null;
}

export function parseChallanKind(value: unknown): ChallanKind {
  return CHALLAN_KINDS.includes(value as ChallanKind) ? (value as ChallanKind) : 'supply';
}

type Queryable = Pick<PoolClient, 'query'>;

interface ChallanRow {
  id: string;
  business_id: string;
  challan_number: string;
  challan_date: string;
  challan_kind: ChallanKind;
  purpose: CustodyPurpose | null;
  status: string;
  customer_id: string | null;
  supplier_id: string | null;
  warehouse_id: string | null;
  branch_id: string | null;
  stock_posted_at: string | null;
  closed_at: string | null;
}

async function lockChallan(client: PoolClient, businessId: string, challanId: string): Promise<ChallanRow> {
  const res = await client.query<ChallanRow>(
    `SELECT id, business_id, challan_number, challan_date::text, challan_kind, purpose, status, customer_id,
            supplier_id, warehouse_id, branch_id, stock_posted_at, closed_at
       FROM delivery_challans WHERE id = $1 AND business_id = $2 FOR UPDATE`,
    [challanId, businessId]
  );
  if (!res.rows[0]) throw new GodownStockError('Delivery challan not found', 404);
  return res.rows[0];
}

function partyOf(c: ChallanRow): { type: 'supplier' | 'customer'; id: string } {
  if (c.supplier_id) return { type: 'supplier', id: c.supplier_id };
  if (c.customer_id) return { type: 'customer', id: c.customer_id };
  throw new GodownStockError('A returnable challan needs the supplier or customer who holds the goods.');
}

async function insertCustodyMovement(
  client: PoolClient,
  c: ChallanRow,
  godown: Godown,
  m: { itemId: string; type: 'in' | 'out'; qty: number; note: string; userId: string | null }
) {
  const party = partyOf(c);
  await client.query(
    `INSERT INTO stock_movements (
       business_id, item_id, location_id, type, quantity, reference_type, reference_id, notes, created_by,
       custody_status, custody_purpose, custody_party_type, custody_party_id
     ) VALUES ($1, $2, $3, $4, $5, 'delivery_challan', $6, $7, $8, 'with_third_party', $9, $10, $11)`,
    [c.business_id, m.itemId, godown.warehouseId, m.type, m.qty, c.id, m.note, m.userId, c.purpose, party.type, party.id]
  );
}

/**
 * Sends a returnable challan's goods out: godown stock goes down and the party now holds them.
 * Runs on the caller's transaction. Sets the challan to sent.
 */
export async function dispatchReturnableChallan(
  client: PoolClient,
  businessId: string,
  challanId: string,
  userId: string | null
): Promise<void> {
  const c = await lockChallan(client, businessId, challanId);
  if (c.challan_kind !== 'returnable') throw new GodownStockError('Only a returnable challan moves stock.', 409);
  if (c.stock_posted_at) throw new GodownStockError('This challan has already been sent out.', 409);
  if (c.status === 'cancelled') throw new GodownStockError('A cancelled challan cannot be sent.', 409);
  partyOf(c);
  const godown = await resolveGodown(client, businessId, { warehouseId: c.warehouse_id, branchId: c.branch_id });

  const lines = await client.query<{ item_id: string; qty: string; item_name: string }>(
    `SELECT dci.item_id, SUM(dci.qty)::text AS qty, MAX(dci.item_name) AS item_name
       FROM delivery_challan_items dci
       JOIN items i ON i.id = dci.item_id AND i.business_id = $2
      WHERE dci.delivery_challan_id = $1 AND dci.item_id IS NOT NULL AND dci.qty > 0
      GROUP BY dci.item_id`,
    [c.id, businessId]
  );
  if (lines.rows.length === 0) throw new GodownStockError('Add at least one stock item before sending the goods out.');

  for (const l of lines.rows) {
    const qty = Number(l.qty);
    try {
      await changeGodownStock(client, businessId, godown, l.item_id, -qty);
    } catch (e) {
      if (e instanceof GodownStockError && e.code === 'INSUFFICIENT_STOCK') {
        throw new GodownStockError(`${l.item_name}: ${e.message}`, 409, e.code);
      }
      throw e;
    }
    await insertCustodyMovement(client, c, godown, {
      itemId: l.item_id,
      type: 'out',
      qty,
      note: `Challan ${c.challan_number}: sent for ${c.purpose}`,
      userId,
    });
  }

  await client.query(
    `UPDATE delivery_challans
        SET stock_posted_at = NOW(), warehouse_id = $3, branch_id = COALESCE(branch_id, $4),
            status = CASE WHEN status = 'draft' THEN 'sent' ELSE status END, updated_at = NOW()
      WHERE id = $1 AND business_id = $2`,
    [c.id, businessId, godown.warehouseId, godown.branchId]
  );
}

export interface ChallanSettlementLine {
  line_id: string;
  /** Came back to the godown. */
  returned?: number;
  /** Sold to the party where it lies (approval, consignment): back on the books so the invoice can take it. */
  invoiced?: number;
  /** Lost or destroyed while with the party. */
  written_off?: number;
}

export interface ChallanSettlementInput {
  date: string;
  lines: ChallanSettlementLine[];
  write_off_reason?: ReasonCode;
  notes?: string | null;
}

const q3 = (n: unknown) => Math.round((Number(n) || 0) * 1000) / 1000;

/**
 * Settles part or all of a sent returnable challan. Returned and invoiced quantities come back
 * into the godown; written-off quantities come back and leave again as an inventory adjustment
 * (with ITC reversal). Closes the challan when nothing is left out.
 */
export async function settleReturnableChallan(
  client: PoolClient,
  businessId: string,
  challanId: string,
  input: ChallanSettlementInput,
  userId: string | null
): Promise<{ closed: boolean; adjustmentIds: string[] }> {
  const c = await lockChallan(client, businessId, challanId);
  if (c.challan_kind !== 'returnable' || !c.stock_posted_at) {
    throw new GodownStockError('Only a returnable challan that has been sent out can take returns.', 409);
  }
  if (c.closed_at) throw new GodownStockError('This challan is already closed.', 409);
  if (!input.date) throw new GodownStockError('Return date is required.');
  if (input.date < c.challan_date) throw new GodownStockError('The return date cannot be before the challan date.');
  const godown = await resolveGodown(client, businessId, { warehouseId: c.warehouse_id, branchId: c.branch_id });

  const res = await client.query<{
    id: string;
    item_id: string;
    item_name: string;
    qty: string;
    qty_returned: string;
    qty_invoiced: string;
    qty_written_off: string;
  }>(
    `SELECT id, item_id, item_name, qty, qty_returned, qty_invoiced, qty_written_off
       FROM delivery_challan_items WHERE delivery_challan_id = $1 AND item_id IS NOT NULL FOR UPDATE`,
    [c.id]
  );
  const byId = new Map(res.rows.map((r) => [r.id, r]));
  const adjustmentIds: string[] = [];
  const reason = input.write_off_reason ?? 'CUSTODY_LOSS';

  for (const s of input.lines) {
    const line = byId.get(s.line_id);
    if (!line) throw new GodownStockError('Challan line not found', 404);
    const returned = q3(s.returned);
    const invoiced = q3(s.invoiced);
    const writtenOff = q3(s.written_off);
    if (returned < 0 || invoiced < 0 || writtenOff < 0) throw new GodownStockError('Quantities cannot be negative.');
    const total = q3(returned + invoiced + writtenOff);
    if (total === 0) continue;
    const open = q3(Number(line.qty) - Number(line.qty_returned) - Number(line.qty_invoiced) - Number(line.qty_written_off));
    if (total > open) {
      throw new GodownStockError(`${line.item_name}: only ${open} is still out on this challan.`, 409);
    }

    await changeGodownStock(client, businessId, godown, line.item_id, total);
    const parts = [
      returned ? `${returned} returned` : '',
      invoiced ? `${invoiced} sold to holder` : '',
      writtenOff ? `${writtenOff} written off` : '',
    ].filter(Boolean);
    await insertCustodyMovement(client, c, godown, {
      itemId: line.item_id,
      type: 'in',
      qty: total,
      note: `Challan ${c.challan_number}: ${parts.join(', ')}`,
      userId,
    });

    if (writtenOff > 0) {
      const adj = await createQuantityAdjustmentOn(client, {
        businessId,
        itemId: line.item_id,
        locationId: godown.warehouseId,
        branchId: godown.branchId,
        direction: 'DECREASE',
        quantity: writtenOff,
        reasonCode: reason,
        reasonNotes: `Lost while out on challan ${c.challan_number}${input.notes ? `: ${input.notes}` : ''}`,
        adjustmentDate: input.date,
        createdBy: userId ?? undefined,
      });
      adjustmentIds.push(adj.adjustmentId);
    }

    await client.query(
      `UPDATE delivery_challan_items
          SET qty_returned = qty_returned + $2, qty_invoiced = qty_invoiced + $3, qty_written_off = qty_written_off + $4
        WHERE id = $1`,
      [line.id, returned, invoiced, writtenOff]
    );
  }

  const left = await client.query<{ open: string; returned: string; invoiced: string; written_off: string }>(
    `SELECT COALESCE(SUM(qty - qty_returned - qty_invoiced - qty_written_off), 0)::text AS open,
            COALESCE(SUM(qty_returned), 0)::text AS returned,
            COALESCE(SUM(qty_invoiced), 0)::text AS invoiced,
            COALESCE(SUM(qty_written_off), 0)::text AS written_off
       FROM delivery_challan_items WHERE delivery_challan_id = $1 AND item_id IS NOT NULL`,
    [c.id]
  );
  const t = left.rows[0];
  const closed = q3(t.open) <= 0;
  if (closed) {
    const used = [
      Number(t.returned) > 0 ? 'returned' : null,
      Number(t.invoiced) > 0 ? 'invoiced' : null,
      Number(t.written_off) > 0 ? 'written_off' : null,
    ].filter(Boolean) as string[];
    await client.query(
      `UPDATE delivery_challans SET closed_at = NOW(), close_reason = $3, status = 'delivered',
              delivered_at = COALESCE(delivered_at, NOW()), updated_at = NOW()
        WHERE id = $1 AND business_id = $2`,
      [c.id, businessId, used.length === 1 ? used[0] : 'mixed']
    );
  }
  return { closed, adjustmentIds };
}

export interface CustodyRow {
  item_id: string;
  item_name: string;
  stock_class: string;
  warehouse_id: string | null;
  warehouse_name: string | null;
  purpose: CustodyPurpose;
  party_type: 'customer' | 'supplier';
  party_id: string;
  party_name: string | null;
  challan_id: string;
  challan_number: string;
  challan_date: string;
  expected_return_date: string | null;
  days_out: number;
  overdue: boolean;
  qty: number;
  eway_bill_number: string | null;
  eway_bill_status: string | null;
}

export interface TransitRow {
  item_id: string;
  item_name: string;
  stock_class: string;
  transfer_id: string;
  transfer_number: string;
  transfer_date: string;
  from_warehouse_id: string;
  from_warehouse_name: string | null;
  to_warehouse_id: string;
  to_warehouse_name: string | null;
  qty: number;
  eway_bill_number: string | null;
  eway_bill_status: string | null;
}

/** Stock held by others on open returnable challans, optionally for one godown. */
export async function custodyBalances(
  db: Queryable,
  businessId: string,
  opts: { warehouseId?: string | null; branchId?: string | null; asOf?: Date } = {}
): Promise<CustodyRow[]> {
  const now = opts.asOf ?? new Date();
  const res = await db.query(
    `WITH held AS (
       SELECT sm.item_id, sm.location_id, sm.custody_purpose, sm.custody_party_type, sm.custody_party_id,
              sm.reference_id AS challan_id,
              -SUM(CASE sm.type WHEN 'in' THEN ABS(sm.quantity) WHEN 'out' THEN -ABS(sm.quantity) ELSE sm.quantity END) AS qty
         FROM stock_movements sm
        WHERE sm.business_id = $1 AND sm.custody_status = 'with_third_party'
          AND ($2::uuid IS NULL OR sm.location_id = $2)
        GROUP BY 1, 2, 3, 4, 5, 6
     )
     SELECT h.item_id, i.name AS item_name, COALESCE(i.stock_class, 'trading') AS stock_class,
            h.location_id AS warehouse_id, w.name AS warehouse_name,
            h.custody_purpose AS purpose, h.custody_party_type AS party_type, h.custody_party_id AS party_id,
            COALESCE(s.name, cu.name) AS party_name,
            dc.id AS challan_id, dc.challan_number, dc.challan_date::text, dc.expected_return_date::text,
            h.qty::float AS qty,
            eb.ewb_number AS eway_bill_number, eb.status AS eway_bill_status, eb.valid_until
       FROM held h
       JOIN items i ON i.id = h.item_id
       JOIN delivery_challans dc ON dc.id = h.challan_id AND dc.business_id = $1
        AND ($3::uuid IS NULL OR dc.branch_id = $3)
       LEFT JOIN warehouses w ON w.id = h.location_id
       LEFT JOIN suppliers s ON h.custody_party_type = 'supplier' AND s.id = h.custody_party_id
       LEFT JOIN customers cu ON h.custody_party_type = 'customer' AND cu.id = h.custody_party_id
       LEFT JOIN LATERAL (
         SELECT ewb_number, status, valid_until FROM eway_bills
          WHERE business_id = $1 AND source_type = 'delivery_challan' AND source_id = dc.id
          ORDER BY generated_at DESC LIMIT 1
       ) eb ON true
      WHERE h.qty > 0.0005
      ORDER BY dc.challan_date, dc.challan_number, i.name`,
    [businessId, opts.warehouseId ?? null, opts.branchId ?? null]
  );
  return res.rows.map((r: any) => {
    const daysOut = Math.max(0, Math.floor((now.getTime() - Date.parse(`${r.challan_date}T00:00:00+05:30`)) / 864e5));
    const today = now.toISOString().slice(0, 10);
    return {
      ...r,
      days_out: daysOut,
      overdue: !!r.expected_return_date && r.expected_return_date < today,
      eway_bill_status: r.eway_bill_number ? effectiveEwayStatus(r.eway_bill_status, r.valid_until, now) : null,
    };
  });
}

/** Stock dispatched on transfers and not yet received, by the godown it left. */
export async function transitBalances(
  db: Queryable,
  businessId: string,
  opts: { warehouseId?: string | null; asOf?: Date } = {}
): Promise<TransitRow[]> {
  const now = opts.asOf ?? new Date();
  const res = await db.query(
    `SELECT sti.item_id, i.name AS item_name, COALESCE(i.stock_class, 'trading') AS stock_class,
            st.id AS transfer_id, st.transfer_number, st.transfer_date::text,
            st.from_location_id AS from_warehouse_id, fw.name AS from_warehouse_name,
            st.to_location_id AS to_warehouse_id, tw.name AS to_warehouse_name,
            SUM(COALESCE(sti.quantity_dispatched, 0) - COALESCE(sti.received_qty, 0))::float AS qty,
            MAX(eb.ewb_number) AS eway_bill_number, MAX(eb.status) AS eway_bill_status, MAX(eb.valid_until) AS valid_until
       FROM stock_transfers st
       JOIN stock_transfer_items sti ON sti.transfer_id = st.id
       JOIN items i ON i.id = sti.item_id
       LEFT JOIN warehouses fw ON fw.id = st.from_location_id
       LEFT JOIN warehouses tw ON tw.id = st.to_location_id
       LEFT JOIN LATERAL (
         SELECT ewb_number, status, valid_until FROM eway_bills
          WHERE business_id = $1 AND source_type = 'stock_transfer' AND source_id = st.id
          ORDER BY generated_at DESC LIMIT 1
       ) eb ON true
      WHERE st.business_id = $1 AND st.status = 'in_transit'
        AND ($2::uuid IS NULL OR st.from_location_id = $2)
      GROUP BY sti.item_id, i.name, i.stock_class, st.id, fw.name, tw.name
     HAVING SUM(COALESCE(sti.quantity_dispatched, 0) - COALESCE(sti.received_qty, 0)) > 0.0005
      ORDER BY st.transfer_date, st.transfer_number, i.name`,
    [businessId, opts.warehouseId ?? null]
  );
  return res.rows.map((r: any) => ({
    ...r,
    eway_bill_status: r.eway_bill_number ? effectiveEwayStatus(r.eway_bill_status, r.valid_until, now) : null,
  }));
}
