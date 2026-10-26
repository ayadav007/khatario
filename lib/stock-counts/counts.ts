import type { PoolClient } from 'pg';
import { currentUnitCosts } from '@/lib/inventory/cogs-posting';
import { godownQuantities, resolveGodown, type Godown } from '@/lib/inventory/godown-stock';
import { createQuantityAdjustmentOn, type ReasonCode } from '@/lib/inventory-adjustment-service';
import { custodyBalances, transitBalances, type CustodyRow, type TransitRow } from '@/lib/stock-custody/custody';
import { inwardTransitBalances, type InwardTransitRow } from '@/lib/purchases/goods-in-transit';
import { heldBalances, type HeldRow } from '@/lib/stock-custody/holds';
import { othersGoodsHeld, type OthersGoodsRow } from '@/lib/stock-custody/inward-custody';

/**
 * Physical stock count of one godown. Opening it captures the book figures and (with freeze on)
 * stops stock moving in or out of that godown until it is posted or cancelled. Counters enter
 * what is on the shelf without seeing the book figure; big differences need a second count.
 * Review shows book stock → stock held elsewhere → expected in godown → counted → unexplained,
 * and posting turns each difference into an inventory adjustment in one transaction.
 */

export class StockCountError extends Error {
  constructor(message: string, readonly status = 400, readonly code = 'STOCK_COUNT') {
    super(message);
  }
}

type Queryable = Pick<PoolClient, 'query'>;

/** CARO 2020 3(ii)(a): differences of 10% or more in a class of inventory are reported. */
export const CARO_DISCREPANCY_PCT = 10;

export const SHORTAGE_REASONS: ReasonCode[] = [
  'STOCK_TAKE', 'DAMAGE', 'THEFT', 'EXPIRED', 'PROCESS_LOSS', 'TRANSIT_LOSS', 'OWN_CONSUMPTION', 'FREE_SAMPLE', 'CUSTODY_LOSS',
];
export const EXCESS_REASONS: ReasonCode[] = ['STOCK_TAKE'];

const q3 = (n: unknown) => Math.round((Number(n) || 0) * 1000) / 1000;
const r2 = (n: number) => Math.round(n * 100) / 100;

export interface OpenCountInput {
  warehouseId?: string | null;
  branchId?: string | null;
  countDate: string;
  blind?: boolean;
  freezeStock?: boolean;
  recountTolerancePct?: number;
  recountToleranceValue?: number;
  writeOffApprovalValue?: number;
  notes?: string | null;
  userId: string | null;
}

interface CountRow {
  id: string;
  business_id: string;
  count_number: string;
  warehouse_id: string | null;
  branch_id: string | null;
  count_date: string;
  status: 'counting' | 'review' | 'posted' | 'cancelled';
  blind: boolean;
  freeze_stock: boolean;
  recount_tolerance_pct: string;
  recount_tolerance_value: string;
  write_off_approval_value: string;
  opened_by: string | null;
}

async function lockCount(client: Queryable, businessId: string, countId: string): Promise<CountRow> {
  const r = await client.query<CountRow>(
    `SELECT id, business_id, count_number, warehouse_id, branch_id, count_date::text, status, blind, freeze_stock,
            recount_tolerance_pct, recount_tolerance_value, write_off_approval_value, opened_by
       FROM stock_counts WHERE id = $1 AND business_id = $2 FOR UPDATE`,
    [countId, businessId]
  );
  if (!r.rows[0]) throw new StockCountError('Stock count not found', 404);
  return r.rows[0];
}

function godownOf(c: CountRow): Godown {
  return { warehouseMode: !!c.warehouse_id, warehouseId: c.warehouse_id, branchId: c.branch_id };
}

function sumBy<T>(rows: T[], key: (r: T) => string, qty: (r: T) => number): Map<string, number> {
  const m = new Map<string, number>();
  for (const r of rows) m.set(key(r), q3((m.get(key(r)) || 0) + qty(r)));
  return m;
}

async function nextCountNumber(client: Queryable, businessId: string, countDate: string): Promise<string> {
  const year = countDate.slice(0, 4);
  const r = await client.query<{ n: number }>(
    `SELECT COUNT(*)::int + 1 AS n FROM stock_counts WHERE business_id = $1 AND count_number LIKE $2`,
    [businessId, `SC-${year}-%`]
  );
  return `SC-${year}-${String(r.rows[0].n).padStart(4, '0')}`;
}

/** Opens a count and captures the book figures for every stock item of the godown. */
export async function openStockCount(client: PoolClient, businessId: string, input: OpenCountInput): Promise<string> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.countDate || '')) throw new StockCountError('Count date is required');
  const godown = await resolveGodown(client, businessId, { warehouseId: input.warehouseId, branchId: input.branchId });

  // One open count per godown; taken under a business-level lock so two opens cannot race.
  await client.query(`SELECT pg_advisory_xact_lock(hashtext('stock_count:' || $1::text))`, [businessId]);
  const open = await client.query(
    `SELECT count_number FROM stock_counts
      WHERE business_id = $1 AND status IN ('counting', 'review')
        AND warehouse_id IS NOT DISTINCT FROM $2 AND (warehouse_id IS NOT NULL OR branch_id IS NOT DISTINCT FROM $3)`,
    [businessId, godown.warehouseId, godown.branchId]
  );
  if (open.rows[0]) {
    throw new StockCountError(`Stock count ${open.rows[0].count_number} is already open for this godown.`, 409, 'COUNT_OPEN');
  }

  const onHand = await godownQuantities(client, businessId, godown, null);
  const custody = await custodyBalances(client, businessId, godown.warehouseMode ? { warehouseId: godown.warehouseId } : { branchId: godown.branchId });
  const transit = godown.warehouseMode ? await transitBalances(client, businessId, { warehouseId: godown.warehouseId }) : [];
  const inward = await inwardTransitBalances(
    client,
    businessId,
    godown.warehouseMode ? { warehouseId: godown.warehouseId } : { branchId: godown.branchId }
  );
  const holds = await heldBalances(client, businessId, godown.warehouseMode ? { warehouseId: godown.warehouseId } : { branchId: godown.branchId });
  const heldBy = sumBy(custody, (r) => r.item_id, (r) => r.qty);
  const onShelfHeld = sumBy(holds, (r) => r.item_id, (r) => r.qty);
  const transitBy = sumBy([...transit, ...inward], (r) => r.item_id, (r) => r.qty);

  const items = await client.query<{ id: string }>(
    `SELECT id FROM items
      WHERE business_id = $1 AND deleted_at IS NULL
        AND (
          (COALESCE(is_active, true) AND COALESCE(item_type, 'goods') <> 'service' AND NOT COALESCE(is_bundle, false))
          OR id = ANY($2::uuid[])
        )`,
    [businessId, [...new Set([...onHand.keys(), ...heldBy.keys(), ...transitBy.keys(), ...onShelfHeld.keys()])]]
  );
  const itemIds = items.rows.map((r) => r.id);
  const cost = itemIds.length
    ? await currentUnitCosts(client, businessId, itemIds, input.countDate, godown.branchId)
    : new Map<string, number>();

  const number = await nextCountNumber(client, businessId, input.countDate);
  const ins = await client.query<{ id: string }>(
    `INSERT INTO stock_counts (
       business_id, count_number, warehouse_id, branch_id, count_date, blind, freeze_stock,
       recount_tolerance_pct, recount_tolerance_value, write_off_approval_value, notes, opened_by
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING id`,
    [
      businessId, number, godown.warehouseId, godown.branchId, input.countDate,
      input.blind !== false, input.freezeStock !== false,
      Math.max(0, Number(input.recountTolerancePct ?? 2)),
      Math.max(0, Number(input.recountToleranceValue ?? 1000)),
      Math.max(0, Number(input.writeOffApprovalValue ?? 10000)),
      input.notes || null, input.userId,
    ]
  );
  const countId = ins.rows[0].id;
  if (itemIds.length) {
    await client.query(
      `INSERT INTO stock_count_lines (count_id, item_id, godown_qty, with_third_party_qty, in_transit_qty, unit_cost, held_qty)
       SELECT $1, x.item_id, x.godown, x.held, x.transit, x.cost, x.on_hold
         FROM UNNEST($2::uuid[], $3::numeric[], $4::numeric[], $5::numeric[], $6::numeric[], $7::numeric[])
           AS x(item_id, godown, held, transit, cost, on_hold)`,
      [
        countId,
        itemIds,
        itemIds.map((id) => onHand.get(id) || 0),
        itemIds.map((id) => heldBy.get(id) || 0),
        itemIds.map((id) => transitBy.get(id) || 0),
        itemIds.map((id) => Math.round((cost.get(id) || 0) * 10000) / 10000),
        itemIds.map((id) => onShelfHeld.get(id) || 0),
      ]
    );
  }
  return countId;
}

export interface CountEntry {
  item_id: string;
  physical_qty: number;
  third_party_qty?: number;
}

/** Big enough to count again: over the % tolerance and over the value tolerance. */
export function needsRecount(godownQty: number, physicalQty: number, unitCost: number, pct: number, value: number): boolean {
  const diff = Math.abs(physicalQty - godownQty);
  if (diff < 0.0005) return false;
  const diffPct = godownQty > 0 ? (diff / godownQty) * 100 : 100;
  return diffPct > pct && diff * unitCost > value;
}

/**
 * Saves counted quantities. The first count of a line outside tolerance is held for a recount;
 * the second entry is taken as the count.
 */
export async function recordCountEntries(
  client: PoolClient,
  businessId: string,
  countId: string,
  entries: CountEntry[],
  userId: string | null
): Promise<{ saved: number; recount: string[] }> {
  const c = await lockCount(client, businessId, countId);
  if (c.status !== 'counting') throw new StockCountError(`Count ${c.count_number} is ${c.status}; counting is closed.`, 409);
  const recount: string[] = [];
  let saved = 0;
  for (const e of entries) {
    const physical = q3(e.physical_qty);
    const others = q3(e.third_party_qty ?? 0);
    if (!Number.isFinite(physical) || physical < 0 || others < 0) {
      throw new StockCountError('Counted quantities cannot be negative.');
    }
    const r = await client.query(
      `SELECT id, godown_qty + held_qty AS godown_qty, unit_cost, physical_qty, recount_required, recounted
         FROM stock_count_lines WHERE count_id = $1 AND item_id = $2 FOR UPDATE`,
      [countId, e.item_id]
    );
    const line = r.rows[0];
    if (!line) throw new StockCountError('Item is not on this count', 404);

    if (line.recount_required && !line.recounted && line.physical_qty !== null) {
      await client.query(
        `UPDATE stock_count_lines SET physical_qty = $2, third_party_qty = $3, recounted = true, counted_by = $4, counted_at = NOW()
          WHERE id = $1`,
        [line.id, physical, others, userId]
      );
    } else {
      const flag = needsRecount(
        Number(line.godown_qty), physical, Number(line.unit_cost),
        Number(c.recount_tolerance_pct), Number(c.recount_tolerance_value)
      );
      await client.query(
        `UPDATE stock_count_lines
            SET physical_qty = $2, first_count_qty = $2, third_party_qty = $3, recount_required = $4, recounted = false,
                counted_by = $5, counted_at = NOW()
          WHERE id = $1`,
        [line.id, physical, others, flag, userId]
      );
      if (flag) recount.push(e.item_id);
    }
    saved++;
  }
  await client.query(`UPDATE stock_counts SET updated_at = NOW() WHERE id = $1`, [countId]);
  return { saved, recount };
}

/** Closes counting. Uncounted lines can be taken as the book figure or as zero. */
export async function submitStockCount(
  client: PoolClient,
  businessId: string,
  countId: string,
  opts: { fillUncounted?: 'book' | 'zero' | null; userId: string | null }
): Promise<void> {
  const c = await lockCount(client, businessId, countId);
  if (c.status !== 'counting') throw new StockCountError(`Count ${c.count_number} is ${c.status}.`, 409);
  const pending = await client.query<{ uncounted: number; recount: number }>(
    `SELECT COUNT(*) FILTER (WHERE physical_qty IS NULL)::int AS uncounted,
            COUNT(*) FILTER (WHERE recount_required AND NOT recounted)::int AS recount
       FROM stock_count_lines WHERE count_id = $1`,
    [countId]
  );
  const p = pending.rows[0];
  if (p.recount > 0) throw new StockCountError(`${p.recount} item(s) still need a second count.`, 409, 'RECOUNT_PENDING');
  if (p.uncounted > 0) {
    if (!opts.fillUncounted) {
      throw new StockCountError(`${p.uncounted} item(s) have not been counted.`, 409, 'UNCOUNTED');
    }
    await client.query(
      `UPDATE stock_count_lines SET physical_qty = CASE WHEN $2 = 'zero' THEN 0 ELSE godown_qty + held_qty END, counted_at = NOW(), counted_by = $3
        WHERE count_id = $1 AND physical_qty IS NULL`,
      [countId, opts.fillUncounted, opts.userId]
    );
  }
  await client.query(
    `UPDATE stock_counts SET status = 'review', submitted_by = $2, submitted_at = NOW(), updated_at = NOW() WHERE id = $1`,
    [countId, opts.userId]
  );
}

export interface ReasonEntry {
  item_id: string;
  reason_code: ReasonCode;
  reason_notes?: string | null;
}

export async function setDifferenceReasons(
  client: PoolClient,
  businessId: string,
  countId: string,
  reasons: ReasonEntry[]
): Promise<void> {
  const c = await lockCount(client, businessId, countId);
  if (c.status !== 'review') throw new StockCountError('Reasons are given once counting is submitted.', 409);
  for (const r of reasons) {
    const line = await client.query(
      `SELECT physical_qty, godown_qty + held_qty AS godown_qty FROM stock_count_lines WHERE count_id = $1 AND item_id = $2`,
      [countId, r.item_id]
    );
    if (!line.rows[0]) throw new StockCountError('Item is not on this count', 404);
    const diff = Number(line.rows[0].physical_qty) - Number(line.rows[0].godown_qty);
    const allowed = diff < 0 ? SHORTAGE_REASONS : EXCESS_REASONS;
    if (!allowed.includes(r.reason_code)) throw new StockCountError(`${r.reason_code} does not fit this difference.`);
    await client.query(
      `UPDATE stock_count_lines SET reason_code = $3, reason_notes = $4 WHERE count_id = $1 AND item_id = $2`,
      [countId, r.item_id, r.reason_code, r.reason_notes || null]
    );
  }
}

export interface ReconciliationLine {
  item_id: string;
  item_name: string;
  item_code: string | null;
  unit: string | null;
  stock_class: string;
  book_qty: number;
  with_third_party_qty: number;
  in_transit_qty: number;
  /** In the godown but not saleable (quarantine, QC, damaged, returns awaiting inspection). */
  held_qty: number;
  expected_qty: number;
  physical_qty: number | null;
  third_party_qty: number;
  difference: number | null;
  unit_cost: number;
  difference_value: number | null;
  recount_required: boolean;
  recounted: boolean;
  first_count_qty: number | null;
  reason_code: string | null;
  reason_notes: string | null;
  needs_reason: boolean;
  adjustment_id: string | null;
}

export interface ClassSummary {
  stock_class: string;
  book_value: number;
  shortage_value: number;
  excess_value: number;
  net_value: number;
  discrepancy_pct: number;
  caro_flag: boolean;
}

export interface Reconciliation {
  count: Record<string, unknown>;
  blind: boolean;
  lines: ReconciliationLine[];
  with_third_party: CustodyRow[];
  in_transit: TransitRow[];
  inward_transit: InwardTransitRow[];
  held: HeldRow[];
  others_goods: OthersGoodsRow[];
  summary: {
    book_qty: number;
    with_third_party_qty: number;
    in_transit_qty: number;
    expected_qty: number;
    physical_qty: number;
    unexplained_qty: number;
    shortage_value: number;
    excess_value: number;
    unproven: number;
    overdue_returns: number;
    third_party_goods_in_godown: number;
    /** Others' goods the register says should be on the shelf. */
    others_goods_registered: number;
    held_qty: number;
  };
  classes: ClassSummary[];
}

/**
 * The count as the reviewer sees it. While counting is open on a blind count, book figures are
 * left out so counters cannot copy them.
 */
export async function stockCountReconciliation(db: Queryable, businessId: string, countId: string): Promise<Reconciliation> {
  const cr = await db.query(
    `SELECT sc.*, sc.count_date::text AS count_date, w.name AS warehouse_name, w.gst_place_type, b.name AS branch_name,
            ou.name AS opened_by_name, pu.name AS posted_by_name
       FROM stock_counts sc
       LEFT JOIN warehouses w ON w.id = sc.warehouse_id
       LEFT JOIN branches b ON b.id = sc.branch_id
       LEFT JOIN users ou ON ou.id = sc.opened_by
       LEFT JOIN users pu ON pu.id = sc.posted_by
      WHERE sc.id = $1 AND sc.business_id = $2`,
    [countId, businessId]
  );
  const count = cr.rows[0];
  if (!count) throw new StockCountError('Stock count not found', 404);
  const blind = count.blind && count.status === 'counting';

  const lr = await db.query(
    `SELECT l.*, i.name AS item_name, i.code AS item_code, i.unit, COALESCE(i.stock_class, 'trading') AS stock_class
       FROM stock_count_lines l JOIN items i ON i.id = l.item_id
      WHERE l.count_id = $1
      ORDER BY i.name`,
    [countId]
  );

  const lines: ReconciliationLine[] = lr.rows.map((l: any) => {
    const godown = Number(l.godown_qty) + Number(l.held_qty);
    const onHold = Number(l.held_qty);
    const held = Number(l.with_third_party_qty);
    const transit = Number(l.in_transit_qty);
    const physical = l.physical_qty === null ? null : Number(l.physical_qty);
    const cost = Number(l.unit_cost);
    const diff = physical === null ? null : q3(physical - godown);
    const diffValue = diff === null ? null : r2(diff * cost);
    const big = diffValue !== null && Math.abs(diffValue) > Number(count.write_off_approval_value);
    return {
      item_id: l.item_id,
      item_name: l.item_name,
      item_code: l.item_code,
      unit: l.unit,
      stock_class: l.stock_class,
      book_qty: blind ? 0 : q3(godown + held + transit),
      with_third_party_qty: blind ? 0 : held,
      in_transit_qty: blind ? 0 : transit,
      held_qty: blind ? 0 : onHold,
      expected_qty: blind ? 0 : godown,
      physical_qty: physical,
      third_party_qty: Number(l.third_party_qty),
      difference: blind ? null : diff,
      unit_cost: blind ? 0 : cost,
      difference_value: blind ? null : diffValue,
      recount_required: l.recount_required,
      recounted: l.recounted,
      first_count_qty: blind ? null : l.first_count_qty === null ? null : Number(l.first_count_qty),
      reason_code: l.reason_code,
      reason_notes: l.reason_notes,
      needs_reason: !blind && big && (!l.reason_code || l.reason_code === 'STOCK_TAKE' || !l.reason_notes),
      adjustment_id: l.adjustment_id,
    };
  });

  const godownRef = count.warehouse_id ? { warehouseId: count.warehouse_id } : { branchId: count.branch_id };
  const custody = blind ? [] : await custodyBalances(db, businessId, godownRef);
  const transit = blind || !count.warehouse_id ? [] : await transitBalances(db, businessId, { warehouseId: count.warehouse_id });
  const inward = blind ? [] : await inwardTransitBalances(db, businessId, godownRef);
  const holds = blind ? [] : await heldBalances(db, businessId, godownRef);
  const others = await othersGoodsHeld(db, businessId, godownRef);

  const counted = lines.filter((l) => l.physical_qty !== null);
  const classes = new Map<string, ClassSummary>();
  for (const l of lines) {
    if (blind) break;
    const k = l.stock_class;
    const s = classes.get(k) ?? { stock_class: k, book_value: 0, shortage_value: 0, excess_value: 0, net_value: 0, discrepancy_pct: 0, caro_flag: false };
    s.book_value = r2(s.book_value + l.expected_qty * l.unit_cost);
    const v = l.difference_value ?? 0;
    if (v < 0) s.shortage_value = r2(s.shortage_value - v);
    if (v > 0) s.excess_value = r2(s.excess_value + v);
    s.net_value = r2(s.excess_value - s.shortage_value);
    classes.set(k, s);
  }
  for (const s of classes.values()) {
    s.discrepancy_pct = s.book_value > 0 ? r2((Math.abs(s.net_value) / s.book_value) * 100) : s.net_value !== 0 ? 100 : 0;
    s.caro_flag = s.discrepancy_pct >= CARO_DISCREPANCY_PCT;
  }

  const total = (f: (l: ReconciliationLine) => number) => q3(lines.reduce((s, l) => s + f(l), 0));
  return {
    count,
    blind,
    lines,
    with_third_party: custody,
    in_transit: transit,
    inward_transit: inward,
    held: holds,
    others_goods: blind ? [] : others,
    summary: {
      book_qty: blind ? 0 : total((l) => l.book_qty),
      with_third_party_qty: blind ? 0 : total((l) => l.with_third_party_qty),
      in_transit_qty: blind ? 0 : total((l) => l.in_transit_qty),
      expected_qty: blind ? 0 : total((l) => l.expected_qty),
      physical_qty: q3(counted.reduce((s, l) => s + (l.physical_qty || 0), 0)),
      unexplained_qty: blind ? 0 : total((l) => l.difference ?? 0),
      shortage_value: blind ? 0 : r2(lines.reduce((s, l) => s + Math.min(0, l.difference_value ?? 0), 0) * -1),
      excess_value: blind ? 0 : r2(lines.reduce((s, l) => s + Math.max(0, l.difference_value ?? 0), 0)),
      unproven: [...custody, ...transit, ...inward].filter((r) => r.eway_bill_status === 'expired').length,
      overdue_returns: custody.filter((r) => r.overdue).length,
      third_party_goods_in_godown: total((l) => l.third_party_qty),
      others_goods_registered: q3(others.reduce((s, r) => s + r.qty, 0)),
      held_qty: blind ? 0 : total((l) => l.held_qty),
    },
    classes: [...classes.values()].sort((a, b) => a.stock_class.localeCompare(b.stock_class)),
  };
}

/**
 * Posts every difference as an inventory adjustment, then locks the count. The approver must not
 * be someone who counted, unless the business has a single active user.
 */
export async function postStockCount(
  client: PoolClient,
  businessId: string,
  countId: string,
  userId: string | null
): Promise<{ adjustments: number }> {
  const c = await lockCount(client, businessId, countId);
  if (c.status !== 'review') throw new StockCountError('Submit the count before posting it.', 409);

  const counters = await client.query<{ counted_by: string }>(
    `SELECT DISTINCT counted_by FROM stock_count_lines WHERE count_id = $1 AND counted_by IS NOT NULL`,
    [countId]
  );
  if (userId && counters.rows.some((r) => r.counted_by === userId)) {
    const users = await client.query<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM users WHERE business_id = $1 AND COALESCE(is_active, true)`,
      [businessId]
    );
    if (users.rows[0].n > 1) {
      throw new StockCountError('Someone who did not count must approve and post this count.', 403, 'SAME_COUNTER');
    }
  }

  const rec = await stockCountReconciliation(client, businessId, countId);
  const missing = rec.lines.filter((l) => l.needs_reason);
  if (missing.length) {
    throw new StockCountError(
      `${missing.length} large difference(s) need a reason and a note before posting.`,
      409,
      'REASON_REQUIRED'
    );
  }

  // The freeze trigger lets this count's own adjustments through.
  await client.query(`SELECT set_config('khatario.stock_count_id', $1, true)`, [countId]);
  let adjustments = 0;
  for (const l of rec.lines) {
    if (l.difference === null || Math.abs(l.difference) < 0.0005 || l.adjustment_id) continue;
    const adj = await createQuantityAdjustmentOn(client, {
      businessId,
      itemId: l.item_id,
      locationId: c.warehouse_id,
      branchId: c.branch_id,
      direction: l.difference > 0 ? 'INCREASE' : 'DECREASE',
      quantity: Math.abs(l.difference),
      reasonCode: (l.reason_code as ReasonCode) || 'STOCK_TAKE',
      reasonNotes: l.reason_notes || `Stock count ${c.count_number}`,
      notes: `Stock count ${c.count_number}`,
      adjustmentDate: c.count_date,
      createdBy: userId ?? undefined,
      stockCountId: countId,
    });
    await client.query(`UPDATE stock_count_lines SET adjustment_id = $3 WHERE count_id = $1 AND item_id = $2`, [
      countId,
      l.item_id,
      adj.adjustmentId,
    ]);
    adjustments++;
  }
  await client.query(
    `UPDATE stock_counts SET status = 'posted', posted_by = $2, posted_at = NOW(), updated_at = NOW() WHERE id = $1`,
    [countId, userId]
  );
  return { adjustments };
}

export async function cancelStockCount(client: PoolClient, businessId: string, countId: string): Promise<void> {
  const c = await lockCount(client, businessId, countId);
  if (c.status === 'posted') throw new StockCountError('A posted count cannot be cancelled.', 409);
  if (c.status === 'cancelled') return;
  await client.query(`UPDATE stock_counts SET status = 'cancelled', cancelled_at = NOW(), updated_at = NOW() WHERE id = $1`, [countId]);
}

/** The open, freezing count for a godown, if any (for friendly refusals before the trigger). */
export async function freezingCount(
  db: Queryable,
  businessId: string,
  warehouseId: string | null
): Promise<{ id: string; count_number: string } | null> {
  const r = await db.query(
    `SELECT id, count_number FROM stock_counts
      WHERE business_id = $1 AND freeze_stock AND status IN ('counting', 'review')
        AND warehouse_id IS NOT DISTINCT FROM $2
      LIMIT 1`,
    [businessId, warehouseId]
  );
  return r.rows[0] ?? null;
}

export async function listStockCounts(db: Queryable, businessId: string): Promise<any[]> {
  const r = await db.query(
    `SELECT sc.id, sc.count_number, sc.count_date::text, sc.status, sc.blind, sc.freeze_stock,
            sc.warehouse_id, w.name AS warehouse_name, sc.branch_id, b.name AS branch_name,
            sc.opened_at, sc.posted_at,
            (SELECT COUNT(*)::int FROM stock_count_lines l WHERE l.count_id = sc.id) AS lines,
            (SELECT COUNT(*)::int FROM stock_count_lines l WHERE l.count_id = sc.id AND l.physical_qty IS NOT NULL) AS counted
       FROM stock_counts sc
       LEFT JOIN warehouses w ON w.id = sc.warehouse_id
       LEFT JOIN branches b ON b.id = sc.branch_id
      WHERE sc.business_id = $1
      ORDER BY sc.opened_at DESC
      LIMIT 200`,
    [businessId]
  );
  return r.rows;
}
