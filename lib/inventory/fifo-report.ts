import * as db from '@/lib/db';
import { getValuationMethod, replayCostItems } from '@/lib/inventory/fifo-costing';
import { getRecostFrom } from '@/lib/inventory/fifo-recost';
import type { Movement, MovementKind } from '@/lib/inventory/fifo-engine';

const r2 = (n: number) => Math.round(n * 100) / 100;
const r3 = (n: number) => Math.round(n * 1000) / 1000;

export interface LotIssue {
  kind: MovementKind;
  doc_id: string;
  doc_number: string | null;
  party: string | null;
  date: string;
  qty: number;
}

export interface LotRow {
  kind: MovementKind;
  doc_id: string;
  doc_number: string | null;
  party: string | null;
  date: string | null;
  qty: number;
  remaining: number;
  unit_cost: number;
  total: number;
  issued_to: LotIssue[];
}

export interface FifoItemReport {
  item_id: string;
  item_name: string;
  open_qty: number;
  open_value: number;
  /** Sold without stock and not yet matched to a lot. */
  unmatched: Array<LotIssue & { unit_cost: number }>;
  lots: LotRow[];
}

export interface FifoLotReport {
  method: string;
  recost_from: string | null;
  as_on_date: string | null;
  items: FifoItemReport[];
  totals: { open_value: number; ledger_inventory: number | null; difference: number | null };
}

export async function buildFifoLotReport(
  businessId: string,
  opts: { itemId?: string | null; asOf?: string | null } = {}
): Promise<FifoLotReport> {
  const pool = db.getPool();
  const method = await getValuationMethod(undefined, businessId);
  const recostFrom = (await getRecostFrom(pool, businessId)) ?? null;

  const itemRows = await db.queryRows<{ id: string }>(
    `SELECT id FROM items
      WHERE business_id = $1 AND item_type = 'goods' AND NOT COALESCE(is_bundle, false)
        AND ($2::uuid IS NULL OR id = $2::uuid)
      ORDER BY name`,
    [businessId, opts.itemId ?? null]
  );
  const ids = itemRows.map((r) => r.id);
  const { movements, replays, names } = await replayCostItems(undefined, businessId, ids, { asOf: opts.asOf ?? null });

  const items: FifoItemReport[] = [];
  let openTotal = 0;
  for (const id of ids) {
    const replay = replays.get(id);
    const list = movements.get(id) ?? [];
    if (!replay || list.length === 0) continue;
    const byKey = new Map<string, Movement>(list.map((m) => [m.key, m]));
    const issuesByLot = new Map<string, LotIssue[]>();
    const unmatched: FifoItemReport['unmatched'] = [];
    for (const result of replay.results.values()) {
      const m = byKey.get(result.key);
      if (!m) continue;
      for (const a of result.allocations) {
        const issue: LotIssue = {
          kind: m.kind, doc_id: m.docId, doc_number: m.docNumber ?? null, party: m.party ?? null, date: m.date, qty: r3(a.qty),
        };
        if (a.lotKey) {
          const arr = issuesByLot.get(a.lotKey) ?? [];
          arr.push(issue);
          issuesByLot.set(a.lotKey, arr);
        } else if (a.pending && !m.peek) {
          unmatched.push({ ...issue, unit_cost: r2(a.unitCost) });
        }
      }
    }
    const lots: LotRow[] = replay.lots.map((l) => ({
      kind: l.kind,
      doc_id: l.docId,
      doc_number: l.docNumber,
      party: l.party,
      date: l.kind === 'opening' ? null : l.date,
      qty: r3(l.qty),
      remaining: r3(Math.max(0, l.remaining)),
      unit_cost: r2(l.unitCost),
      total: r2(l.qty * l.unitCost),
      issued_to: (issuesByLot.get(l.key) ?? []).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0)),
    }));
    openTotal += replay.openValue;
    items.push({
      item_id: id,
      item_name: names.get(id) ?? '',
      open_qty: r3(replay.openQty - replay.deficitQty),
      open_value: r2(replay.openValue),
      unmatched,
      lots,
    });
  }

  const open = r2(openTotal);
  // 1104 is not kept per item, so the reconciliation only makes sense for the whole business.
  if (opts.itemId) {
    return {
      method, recost_from: recostFrom, as_on_date: opts.asOf ?? null, items,
      totals: { open_value: open, ledger_inventory: null, difference: null },
    };
  }
  const ledger = await db.queryRows<{ bal: string }>(
    `SELECT COALESCE(SUM(l.debit - l.credit), 0) AS bal
       FROM ledger_entry_lines l
       JOIN accounts a ON a.id = l.account_id AND a.account_code = '1104'
      WHERE l.business_id = $1 AND ($2::date IS NULL OR l.entry_date <= $2::date)`,
    [businessId, opts.asOf ?? null]
  );
  const ledgerInventory = r2(Number(ledger[0]?.bal) || 0);
  return {
    method,
    recost_from: recostFrom,
    as_on_date: opts.asOf ?? null,
    items,
    totals: { open_value: open, ledger_inventory: ledgerInventory, difference: r2(open - ledgerInventory) },
  };
}
