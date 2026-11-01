import type { PoolClient } from 'pg';
import { currentUnitCosts } from '@/lib/inventory/cogs-posting';
import { MOVEMENT_DATE_SQL, SIGNED_MOVEMENT_QTY_SQL } from '@/lib/inventory/stock-as-of';
import { fetchPartyLedgerDocs } from '@/lib/reports/party-ledger-docs';
import { buildAgeing, type AgeingTotals } from '@/lib/reports/ageing';
import { isWarehouseModeEnabled } from '@/lib/warehouse-mode';

/**
 * Stock reports auditors and banks ask for. A dated quantity is today's owned stock less the
 * movements recorded after that date (by document date). Internal movements (transfers between
 * own godowns, custody to and from parties) leave the goods ours and are not flows, so goods in
 * transit or out on a returnable challan stay in the closing figure.
 */

type Queryable = Pick<PoolClient, 'query'>;

const q3 = (n: unknown) => Math.round((Number(n) || 0) * 1000) / 1000;
const r2 = (n: number) => Math.round(n * 100) / 100;

const INTERNAL_SQL = `(sm.reference_type IN ('stock_transfer', 'transfer') OR sm.custody_status IS NOT NULL)`;

/**
 * Owned quantity per item now: on hand in the godowns, plus what is with parties or in transit
 * (from suppliers or between own godowns). Dated figures work back from this through the
 * movements recorded after the date, so stock entered without a movement still counts.
 */
export async function currentOwnedQty(db: Queryable, businessId: string): Promise<Map<string, number>> {
  const onHand = (await isWarehouseModeEnabled(businessId))
    ? `SELECT ls.item_id, ls.current_stock_qty AS q FROM location_stock ls
         JOIN warehouses w ON w.id = ls.location_id AND w.business_id = $1`
    : `SELECT item_id, quantity AS q FROM branch_item_stock WHERE business_id = $1`;
  const r = await db.query(
    `SELECT item_id, SUM(q)::float AS qty FROM (
       ${onHand}
       UNION ALL
       SELECT sm.item_id, -(${SIGNED_MOVEMENT_QTY_SQL}) AS q
         FROM stock_movements sm WHERE sm.business_id = $1 AND sm.custody_status IS NOT NULL
       UNION ALL
       SELECT sti.item_id, COALESCE(sti.quantity_dispatched, 0) - COALESCE(sti.received_qty, 0) - COALESCE(sti.qty_short, 0)
         FROM stock_transfer_items sti JOIN stock_transfers st ON st.id = sti.transfer_id
        WHERE st.business_id = $1 AND st.status = 'in_transit'
     ) x GROUP BY item_id`,
    [businessId]
  );
  return new Map(r.rows.map((x: any) => [x.item_id, q3(x.qty)]));
}

/** Column of Form 3CD clause 35(a) each movement falls in. */
const FLOW_SQL = `
  CASE
    WHEN sm.reference_type IN ('purchase', 'purchase_cancel') THEN 'purchases'
    WHEN sm.reference_type IN ('purchase_return', 'purchase_return_cancel', 'debit_note', 'debit_note_cancel') THEN 'purchase_returns'
    WHEN sm.reference_type IN ('invoice', 'sale', 'invoice_cancel', 'sale_cancel') THEN 'sales'
    WHEN sm.reference_type IN ('credit_note', 'credit_note_cancel', 'sales_return') THEN 'sales_returns'
    WHEN sm.reference_type = 'adjustment' THEN 'adjustments'
    WHEN sm.reference_type = 'production' AND sm.quantity < 0 THEN 'consumed'
    WHEN sm.reference_type = 'production' THEN 'produced'
    ELSE 'other'
  END`;

export interface QuantitativeRow {
  item_id: string;
  item_name: string;
  item_code: string | null;
  unit: string | null;
  stock_class: string;
  opening: number;
  purchases: number;
  purchase_returns: number;
  sales: number;
  sales_returns: number;
  shortage: number;
  excess: number;
  other: number;
  /** Manufacturing (clause 35(b)): raw material consumed and goods produced. */
  consumed: number;
  produced: number;
  closing: number;
}

/**
 * Form 3CD clause 35(a), trading goods: opening, purchases, sales, closing and shortage/excess
 * per item for [from, to]. Purchases and sales are net of their returns in the columns that say
 * so; `other` holds movements of other kinds (opening stock entered mid-year, repacking).
 */
export async function quantitativeDetails(db: Queryable, businessId: string, from: string, to: string): Promise<QuantitativeRow[]> {
  const owned = await currentOwnedQty(db, businessId);
  const r = await db.query(
    `WITH m AS (
       SELECT sm.item_id, ${MOVEMENT_DATE_SQL} AS d, ${FLOW_SQL} AS flow, ${SIGNED_MOVEMENT_QTY_SQL} AS q
         FROM stock_movements sm
        WHERE sm.business_id = $1 AND NOT ${INTERNAL_SQL}
     )
     SELECT i.id AS item_id, i.name AS item_name, i.code AS item_code, COALESCE(i.uqc, i.unit) AS unit,
            COALESCE(i.stock_class, 'trading') AS stock_class,
            COALESCE(SUM(m.q) FILTER (WHERE m.d >= $2::date), 0)::float AS after_from,
            COALESCE(SUM(m.q) FILTER (WHERE m.d BETWEEN $2::date AND $3::date AND m.flow = 'purchases'), 0)::float AS purchases,
            COALESCE(-SUM(m.q) FILTER (WHERE m.d BETWEEN $2::date AND $3::date AND m.flow = 'purchase_returns'), 0)::float AS purchase_returns,
            COALESCE(-SUM(m.q) FILTER (WHERE m.d BETWEEN $2::date AND $3::date AND m.flow = 'sales'), 0)::float AS sales,
            COALESCE(SUM(m.q) FILTER (WHERE m.d BETWEEN $2::date AND $3::date AND m.flow = 'sales_returns'), 0)::float AS sales_returns,
            COALESCE(-SUM(m.q) FILTER (WHERE m.d BETWEEN $2::date AND $3::date AND m.flow = 'adjustments' AND m.q < 0), 0)::float AS shortage,
            COALESCE(SUM(m.q) FILTER (WHERE m.d BETWEEN $2::date AND $3::date AND m.flow = 'adjustments' AND m.q > 0), 0)::float AS excess,
            COALESCE(SUM(m.q) FILTER (WHERE m.d BETWEEN $2::date AND $3::date AND m.flow = 'other'), 0)::float AS other,
            COALESCE(-SUM(m.q) FILTER (WHERE m.d BETWEEN $2::date AND $3::date AND m.flow = 'consumed'), 0)::float AS consumed,
            COALESCE(SUM(m.q) FILTER (WHERE m.d BETWEEN $2::date AND $3::date AND m.flow = 'produced'), 0)::float AS produced,
            COALESCE(SUM(m.q) FILTER (WHERE m.d > $3::date), 0)::float AS after_to
       FROM items i
       LEFT JOIN m ON m.item_id = i.id
      WHERE i.business_id = $1 AND COALESCE(i.item_type, 'goods') = 'goods' AND i.id = ANY($4::uuid[])
      GROUP BY i.id
      ORDER BY i.name`,
    [businessId, from, to, [...owned.keys(), ...(await itemsWithMovements(db, businessId))]]
  );
  const rows: QuantitativeRow[] = r.rows.map(({ after_from, after_to, ...x }: any) => {
    const now = owned.get(x.item_id) || 0;
    return {
      ...x,
      opening: q3(now - after_from),
      purchases: q3(x.purchases),
      purchase_returns: q3(x.purchase_returns),
      sales: q3(x.sales),
      sales_returns: q3(x.sales_returns),
      shortage: q3(x.shortage),
      excess: q3(x.excess),
      other: q3(x.other),
      consumed: q3(x.consumed),
      produced: q3(x.produced),
      closing: q3(now - after_to),
    };
  });
  return rows.filter(
    (x) =>
      x.opening || x.closing || x.purchases || x.purchase_returns || x.sales || x.sales_returns || x.shortage || x.excess || x.other ||
      x.consumed || x.produced
  );
}

async function itemsWithMovements(db: Queryable, businessId: string): Promise<string[]> {
  const r = await db.query(`SELECT DISTINCT item_id FROM stock_movements WHERE business_id = $1 AND item_id IS NOT NULL`, [businessId]);
  return r.rows.map((x: any) => x.item_id);
}

export interface BankStatementMargins {
  /** Bank's margin on stock, % (often 25). */
  stockMarginPct: number;
  /** Bank's margin on debtors, %. */
  debtorMarginPct: number;
  /** Debtors older than this many days past due are not counted. */
  debtorAgeLimitDays: 90 | 60 | 30;
}

export interface BankStockLine {
  item_id: string;
  item_name: string;
  stock_class: string;
  qty: number;
  unit_cost: number;
  value: number;
  last_inward: string | null;
  age_bucket: '0-90' | '91-180' | '181-365' | '365+' | 'no purchase';
  slow_moving: boolean;
}

const AGE_BUCKETS = ['0-90', '91-180', '181-365', '365+', 'no purchase'] as const;

function ageBucket(lastInward: string | null, asOf: string): BankStockLine['age_bucket'] {
  if (!lastInward) return 'no purchase';
  const days = Math.round((Date.parse(`${asOf}T00:00:00Z`) - Date.parse(`${lastInward}T00:00:00Z`)) / 864e5);
  if (days <= 90) return '0-90';
  if (days <= 180) return '91-180';
  if (days <= 365) return '181-365';
  return '365+';
}

function eligibleDebtors(t: AgeingTotals, limit: BankStatementMargins['debtorAgeLimitDays']): number {
  const parts = [t.not_due, t.age_0_30];
  if (limit >= 60) parts.push(t.age_30_60);
  if (limit >= 90) parts.push(t.age_60_90);
  return r2(parts.reduce((s, n) => s + n, 0));
}

/**
 * Stock statement for a cash-credit or overdraft limit as on a date: owned stock (goods in
 * transit and with job workers included, nothing held for others) by class, age and movement,
 * with debtor and creditor ageing and an indicative drawing power. The bank's own sanction terms
 * decide the real figure.
 */
export async function bankStockStatement(
  db: Queryable,
  businessId: string,
  asOf: string,
  margins: BankStatementMargins
) {
  const owned = await currentOwnedQty(db, businessId);
  const r = await db.query(
    `WITH m AS (
       SELECT sm.item_id, ${MOVEMENT_DATE_SQL} AS d, ${FLOW_SQL} AS flow, ${SIGNED_MOVEMENT_QTY_SQL} AS q
         FROM stock_movements sm
        WHERE sm.business_id = $1 AND NOT ${INTERNAL_SQL}
     )
     SELECT i.id AS item_id, i.name AS item_name, COALESCE(i.stock_class, 'trading') AS stock_class,
            COALESCE(SUM(m.q) FILTER (WHERE m.d > $2::date), 0)::float AS after,
            (MAX(m.d) FILTER (WHERE m.d <= $2::date AND m.flow = 'purchases' AND m.q > 0))::text AS last_inward,
            COUNT(*) FILTER (WHERE m.flow = 'sales' AND m.d BETWEEN ($2::date - 90) AND $2::date) AS recent_sales
       FROM items i LEFT JOIN m ON m.item_id = i.id
      WHERE i.business_id = $1 AND COALESCE(i.item_type, 'goods') = 'goods' AND i.id = ANY($3::uuid[])
      GROUP BY i.id
      ORDER BY i.name`,
    [businessId, asOf, [...owned.keys(), ...(await itemsWithMovements(db, businessId))]]
  );
  const held = r.rows
    .map((x: any) => ({ ...x, qty: q3((owned.get(x.item_id) || 0) - x.after) }))
    .filter((x: any) => x.qty > 0.0005);
  const ids = held.map((x: any) => x.item_id);
  const cost = ids.length ? await currentUnitCosts(db, businessId, ids, asOf) : new Map<string, number>();
  const lines: BankStockLine[] = held.map((x: any) => {
    const unit = r2(cost.get(x.item_id) || 0);
    const qty = x.qty;
    return {
      item_id: x.item_id,
      item_name: x.item_name,
      stock_class: x.stock_class,
      qty,
      unit_cost: unit,
      value: r2(qty * unit),
      last_inward: x.last_inward,
      age_bucket: ageBucket(x.last_inward, asOf),
      slow_moving: Number(x.recent_sales) === 0,
    };
  });

  const byClass = new Map<string, number>();
  const byAge = new Map<string, number>(AGE_BUCKETS.map((b) => [b, 0]));
  for (const l of lines) {
    byClass.set(l.stock_class, r2((byClass.get(l.stock_class) || 0) + l.value));
    byAge.set(l.age_bucket, r2((byAge.get(l.age_bucket) || 0) + l.value));
  }
  const stockValue = r2(lines.reduce((s, l) => s + l.value, 0));
  const slowValue = r2(lines.filter((l) => l.slow_moving).reduce((s, l) => s + l.value, 0));

  const [debtorDocs, creditorDocs] = await Promise.all([
    fetchPartyLedgerDocs({ businessId, partyType: 'customer', asOfDate: asOf }),
    fetchPartyLedgerDocs({ businessId, partyType: 'supplier', asOfDate: asOf }),
  ]);
  const debtors = buildAgeing(debtorDocs, asOf).totals;
  const creditors = buildAgeing(creditorDocs, asOf).totals;
  const eligible = eligibleDebtors(debtors, margins.debtorAgeLimitDays);
  const paidStock = Math.max(0, r2(stockValue - Math.max(0, creditors.total)));
  const drawingPower = r2(
    paidStock * (1 - margins.stockMarginPct / 100) + Math.max(0, eligible) * (1 - margins.debtorMarginPct / 100)
  );

  return {
    as_of: asOf,
    margins,
    stock: {
      total_value: stockValue,
      by_class: [...byClass.entries()].map(([stock_class, value]) => ({ stock_class, value })),
      by_age: [...byAge.entries()].map(([bucket, value]) => ({ bucket, value })),
      slow_moving_value: slowValue,
      lines,
    },
    debtors,
    creditors,
    eligible_debtors: eligible,
    paid_stock: paidStock,
    drawing_power: drawingPower,
  };
}
