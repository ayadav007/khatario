import type { PoolClient } from 'pg';
import * as db from '@/lib/db';
import { activeLedgerLineSql } from '@/lib/ledger-reversal';
import { issueUnitCost, replayItem, type ItemReplay, type Movement } from '@/lib/inventory/fifo-engine';

type Queryable = Pick<PoolClient, 'query'>;

export type ValuationMethod = 'fifo' | 'weighted_avg' | 'simple';

/** Document whose cost is being posted: included in the replay even before its own posting is active. */
export type CostTarget = { kind: 'invoice' | 'credit_note' | 'adjustment_out'; docId: string };

async function rows<T extends Record<string, unknown>>(client: Queryable | undefined, sql: string, params: unknown[]): Promise<T[]> {
  if (client) return (await client.query<T>(sql, params)).rows;
  return db.queryRows<T>(sql, params);
}

export async function getValuationMethod(client: Queryable | undefined, businessId: string): Promise<ValuationMethod> {
  const r = await rows<{ m: string | null }>(
    client,
    'SELECT stock_valuation_method AS m FROM business_settings WHERE business_id = $1',
    [businessId]
  );
  const m = r[0]?.m;
  return m === 'weighted_avg' || m === 'simple' ? m : 'fifo';
}

/** Serialises cost computation per item so concurrent issues cannot consume the same lot. */
export async function lockCostItems(client: Queryable, businessId: string, itemIds: string[]): Promise<void> {
  for (const id of [...new Set(itemIds)].sort()) {
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))', [`fifo:${businessId}`, id]);
  }
}

const SEQ = `to_char(%s, 'YYYY-MM-DD"T"HH24:MI:SS.US')`;
const seq = (col: string) => SEQ.replace('%s', `COALESCE(${col}, 'epoch'::timestamp)`);
const day = (col: string) => `to_char(${col}, 'YYYY-MM-DD')`;

/** Goods lines of `table` for the given items; bundles count as their goods components. */
function goodsLinesSql(table: 'invoice_items' | 'credit_note_items', docCol: string, qtyCol: string): string {
  return `
    SELECT l.${docCol} AS doc_id, l.item_id, l.${qtyCol}::numeric AS qty
      FROM ${table} l
      JOIN items it ON it.id = l.item_id AND it.item_type = 'goods' AND NOT COALESCE(it.is_bundle, false)
     WHERE l.item_id = ANY($2::uuid[])
    UNION ALL
    SELECT l.${docCol}, bi.item_id, (l.${qtyCol} * bi.quantity)::numeric
      FROM ${table} l
      JOIN items b ON b.id = l.item_id AND b.item_type = 'goods' AND COALESCE(b.is_bundle, false)
      JOIN bundle_items bi ON bi.bundle_id = b.id
      JOIN items c ON c.id = bi.item_id AND c.item_type = 'goods'
     WHERE bi.item_id = ANY($2::uuid[])`;
}

export interface LoadedItems {
  movements: Map<string, Movement[]>;
  fallback: Map<string, number>;
  names: Map<string, string>;
}

/**
 * Stock movements that affect cost, per item, from the source documents:
 * opening stock, live purchases, posted invoices and credit notes, live purchase returns,
 * and adjustments that were not reversed.
 */
export async function loadCostMovements(
  client: Queryable | undefined,
  businessId: string,
  itemIds: string[],
  opts: { target?: CostTarget | null; asOf?: string | null } = {}
): Promise<LoadedItems> {
  const ids = [...new Set(itemIds)];
  const movements = new Map<string, Movement[]>(ids.map((id) => [id, []]));
  const fallback = new Map<string, number>();
  const names = new Map<string, string>();
  if (ids.length === 0) return { movements, fallback, names };
  const push = (itemId: string, m: Movement) => movements.get(itemId)?.push(m);
  const targetId = opts.target?.docId ?? null;

  const items = await rows<{ id: string; name: string; qty: string; value: string; fallback: string }>(
    client,
    `SELECT i.id, i.name,
            COALESCE(i.opening_stock, 0) + COALESCE(v.qty, 0) AS qty,
            COALESCE(i.opening_stock, 0) * COALESCE(i.opening_stock_rate, i.purchase_price, 0) + COALESCE(v.value, 0) AS value,
            COALESCE(i.opening_stock_rate, i.purchase_price, 0) AS fallback
       FROM items i
       LEFT JOIN (
         SELECT v.item_id, SUM(COALESCE(v.opening_stock, 0)) AS qty,
                SUM(COALESCE(v.opening_stock, 0) * COALESCE(v.purchase_price, p.purchase_price, 0)) AS value
           FROM item_variants v
           JOIN items p ON p.id = v.item_id
          WHERE v.item_id = ANY($2::uuid[])
          GROUP BY v.item_id
       ) v ON v.item_id = i.id
      WHERE i.business_id = $1 AND i.id = ANY($2::uuid[])`,
    [businessId, ids]
  );
  for (const i of items) {
    names.set(i.id, i.name);
    fallback.set(i.id, Number(i.fallback) || 0);
    const qty = Number(i.qty) || 0;
    if (qty > 0) {
      push(i.id, {
        key: `opening:${i.id}`,
        kind: 'opening',
        docId: i.id,
        docNumber: 'Opening stock',
        date: '0001-01-01',
        seq: '',
        qty,
        unitCost: (Number(i.value) || 0) / qty,
      });
    }
  }

  const purchases = await rows<{
    item_id: string; doc_id: string; line_id: string; doc_number: string | null; party: string | null;
    d: string; s: string; qty: string; value: string;
  }>(
    client,
    `SELECT pi.item_id, pu.id AS doc_id, pi.id AS line_id,
            COALESCE(pu.bill_number, pu.invoice_number) AS doc_number, s.name AS party,
            ${day('pu.bill_date')} AS d, ${seq('pu.created_at')} AS s,
            pi.quantity AS qty, COALESCE(pi.taxable_value, 0) AS value
       FROM purchase_items pi
       JOIN purchases pu ON pu.id = pi.purchase_id
       JOIN items it ON it.id = pi.item_id AND it.item_type = 'goods'
       LEFT JOIN suppliers s ON s.id = pu.supplier_id
      WHERE pu.business_id = $1 AND pi.item_id = ANY($2::uuid[])
        AND COALESCE(pu.status, '') NOT IN ('cancelled', 'draft')
        AND pu.deleted_at IS NULL
        AND pi.quantity > 0
        AND COALESCE(pi.line_item_type, 'goods') <> 'service'
        AND COALESCE(pi.hsn_sac, '') NOT LIKE '99%'
        AND pi.itc_type IS DISTINCT FROM 'capital_goods'`,
    [businessId, ids]
  );
  for (const p of purchases) {
    const qty = Number(p.qty) || 0;
    push(p.item_id, {
      key: `purchase:${p.doc_id}:${p.line_id}`,
      kind: 'purchase',
      docId: p.doc_id,
      docNumber: p.doc_number,
      party: p.party,
      date: p.d,
      seq: p.s,
      qty,
      unitCost: qty > 0 ? (Number(p.value) || 0) / qty : 0,
    });
  }

  const invoices = await rows<{
    item_id: string; doc_id: string; doc_number: string | null; party: string | null;
    d: string; s: string; qty: string; peek: boolean;
  }>(
    client,
    `SELECT x.item_id, i.id AS doc_id, i.invoice_number AS doc_number, c.name AS party,
            ${day('i.invoice_date')} AS d, ${seq('i.created_at')} AS s, SUM(x.qty) AS qty,
            EXISTS (SELECT 1 FROM stock_transfers st WHERE st.inter_branch_invoice_id = i.id) AS peek
       FROM (${goodsLinesSql('invoice_items', 'invoice_id', 'quantity')}) x
       JOIN invoices i ON i.id = x.doc_id AND i.business_id = $1
       LEFT JOIN customers c ON c.id = i.customer_id
      WHERE (i.id = $3::uuid OR EXISTS (
              SELECT 1 FROM ledger_entry_lines l
               WHERE l.business_id = $1 AND l.voucher_type = 'invoice' AND l.voucher_id = i.id
                 AND ${activeLedgerLineSql('l')}))
      GROUP BY x.item_id, i.id, c.name`,
    [businessId, ids, opts.target?.kind === 'invoice' ? targetId : null]
  );
  for (const r of invoices) {
    push(r.item_id, {
      key: `invoice:${r.doc_id}`,
      kind: 'invoice',
      docId: r.doc_id,
      docNumber: r.doc_number,
      party: r.party,
      date: r.d,
      seq: r.s,
      qty: Number(r.qty) || 0,
      peek: r.peek === true,
    });
  }

  const notes = await rows<{
    item_id: string; doc_id: string; doc_number: string | null; party: string | null;
    d: string; s: string; qty: string; invoice_id: string | null;
  }>(
    client,
    `SELECT x.item_id, cn.id AS doc_id, cn.credit_note_number AS doc_number, c.name AS party,
            ${day('cn.credit_note_date')} AS d, ${seq('cn.created_at')} AS s, SUM(x.qty) AS qty, cn.invoice_id
       FROM (${goodsLinesSql('credit_note_items', 'credit_note_id', 'qty')}) x
       JOIN credit_notes cn ON cn.id = x.doc_id AND cn.business_id = $1
       LEFT JOIN customers c ON c.id = cn.customer_id
      WHERE (cn.id = $3::uuid OR EXISTS (
              SELECT 1 FROM ledger_entry_lines l
               WHERE l.business_id = $1 AND l.voucher_type = 'credit_note' AND l.voucher_id = cn.id
                 AND ${activeLedgerLineSql('l')}))
      GROUP BY x.item_id, cn.id, c.name`,
    [businessId, ids, opts.target?.kind === 'credit_note' ? targetId : null]
  );
  for (const r of notes) {
    push(r.item_id, {
      key: `credit_note:${r.doc_id}`,
      kind: 'credit_note',
      docId: r.doc_id,
      docNumber: r.doc_number,
      party: r.party,
      date: r.d,
      seq: r.s,
      qty: Number(r.qty) || 0,
      linkedDocId: r.invoice_id,
    });
  }

  const returns = await rows<{
    item_id: string; doc_id: string; doc_number: string | null; party: string | null;
    d: string; s: string; qty: string; purchase_id: string | null;
  }>(
    client,
    `SELECT pri.item_id, pr.id AS doc_id, pr.return_number AS doc_number, s.name AS party,
            ${day('pr.return_date')} AS d, ${seq('pr.created_at')} AS s, SUM(pri.qty) AS qty, pr.purchase_id
       FROM purchase_return_items pri
       JOIN purchase_returns pr ON pr.id = pri.return_id
       JOIN items it ON it.id = pri.item_id AND it.item_type = 'goods'
       LEFT JOIN suppliers s ON s.id = pr.supplier_id
      WHERE pr.business_id = $1 AND pri.item_id = ANY($2::uuid[])
        AND COALESCE(pr.status, 'final') <> 'cancelled'
      GROUP BY pri.item_id, pr.id, s.name`,
    [businessId, ids]
  );
  for (const r of returns) {
    push(r.item_id, {
      key: `purchase_return:${r.doc_id}`,
      kind: 'purchase_return',
      docId: r.doc_id,
      docNumber: r.doc_number,
      party: r.party,
      date: r.d,
      seq: r.s,
      qty: Number(r.qty) || 0,
      linkedDocId: r.purchase_id,
    });
  }

  const adjustments = await rows<{
    item_id: string; doc_id: string; doc_number: string | null; d: string; s: string;
    adjustment_type: string; direction: string | null; quantity_change: string | null; value_change: string | null;
  }>(
    client,
    `SELECT ia.item_id, ia.id AS doc_id, ia.adjustment_number AS doc_number,
            ${day('ia.adjustment_date')} AS d, ${seq('ia.created_at')} AS s,
            ia.adjustment_type, ia.direction, ia.quantity_change, ia.value_change
       FROM inventory_adjustments ia
      WHERE ia.business_id = $1 AND ia.item_id = ANY($2::uuid[])
        AND NOT EXISTS (
              SELECT 1 FROM ledger_entry_reversals r
               WHERE r.business_id = $1 AND r.voucher_type = 'stock_adjustment' AND r.voucher_id = ia.id)`,
    [businessId, ids]
  );
  for (const a of adjustments) {
    const base = { docId: a.doc_id, docNumber: a.doc_number, date: a.d, seq: a.s };
    if (a.adjustment_type === 'VALUE') {
      push(a.item_id, { ...base, key: `value_adjustment:${a.doc_id}`, kind: 'value_adjustment', qty: 0, value: Number(a.value_change) || 0 });
      continue;
    }
    const qty = Math.abs(Number(a.quantity_change) || 0);
    if (qty <= 0) continue;
    if (a.direction === 'DECREASE') {
      push(a.item_id, { ...base, key: `adjustment_out:${a.doc_id}`, kind: 'adjustment_out', qty });
    } else {
      const value = a.value_change == null ? null : Math.abs(Number(a.value_change));
      push(a.item_id, {
        ...base,
        key: `adjustment_in:${a.doc_id}`,
        kind: 'adjustment_in',
        qty,
        unitCost: value != null && value > 0 ? value / qty : null,
      });
    }
  }

  if (opts.asOf) {
    for (const [id, list] of movements) {
      movements.set(id, list.filter((m) => m.kind === 'opening' || m.date <= opts.asOf!));
    }
  }
  return { movements, fallback, names };
}

export interface ReplayedItems extends LoadedItems {
  replays: Map<string, ItemReplay>;
}

export async function replayCostItems(
  client: Queryable | undefined,
  businessId: string,
  itemIds: string[],
  opts: { target?: CostTarget | null; asOf?: string | null } = {}
): Promise<ReplayedItems> {
  const loaded = await loadCostMovements(client, businessId, itemIds, opts);
  const replays = new Map<string, ItemReplay>();
  for (const [id, list] of loaded.movements) {
    replays.set(id, replayItem(list, loaded.fallback.get(id) ?? 0));
  }
  return { ...loaded, replays };
}

/**
 * FIFO cost of one document's goods. `qtyByItem` is the document's goods quantity per item
 * (bundles already expanded); an item the replay did not see is costed at the next-out rate.
 */
export async function fifoCostForDocument(
  client: Queryable,
  businessId: string,
  qtyByItem: Map<string, number>,
  target: CostTarget
): Promise<number> {
  const ids = [...qtyByItem.keys()];
  if (ids.length === 0) return 0;
  await lockCostItems(client, businessId, ids);
  const { replays, fallback } = await replayCostItems(client, businessId, ids, { target });
  let total = 0;
  for (const [id, qty] of qtyByItem) {
    const replay = replays.get(id);
    const result = replay?.results.get(`${target.kind}:${target.docId}`);
    if (result) total += result.cost;
    else if (replay) total += qty * issueUnitCost(replay, fallback.get(id) ?? 0, qty);
  }
  return Math.round(total * 100) / 100;
}

/** Unit cost of the next unit out of each item as of a date (nothing consumed). */
export async function fifoIssueUnitCosts(
  client: Queryable | undefined,
  businessId: string,
  itemIds: string[],
  asOf?: string | null
): Promise<Map<string, number>> {
  const { replays, fallback } = await replayCostItems(client, businessId, itemIds, { asOf: asOf ?? null });
  const out = new Map<string, number>();
  for (const [id, replay] of replays) out.set(id, issueUnitCost(replay, fallback.get(id) ?? 0, 1));
  return out;
}

/**
 * Carrying cost per unit of each item's open lots as of a date (open value ÷ open qty);
 * items with no open lot use the next-out rate. Quantities on hand come from stock tables.
 */
export async function fifoOpenUnitCosts(
  client: Queryable | undefined,
  businessId: string,
  itemIds: string[],
  asOf?: string | null
): Promise<Map<string, number>> {
  const { replays, fallback } = await replayCostItems(client, businessId, itemIds, { asOf: asOf ?? null });
  const out = new Map<string, number>();
  for (const [id, replay] of replays) {
    out.set(
      id,
      replay.openQty > 1e-9 ? replay.openValue / replay.openQty : issueUnitCost(replay, fallback.get(id) ?? 0, 1)
    );
  }
  return out;
}

export function toDateString(d: Date | string): string {
  if (typeof d === 'string') return d.slice(0, 10);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
