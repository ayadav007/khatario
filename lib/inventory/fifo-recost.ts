import type { PoolClient } from 'pg';
import { accountIdByCode, insertVoucherLines, round2, type VoucherLine } from '@/lib/accounting/voucher-posting';
import { counterAccountCodes, type AdjustmentReason } from '@/lib/inventory/adjustment-posting';
import {
  getValuationMethod,
  lockCostItems,
  replayCostItems,
} from '@/lib/inventory/fifo-costing';

export const RECOST_NARRATION = 'FIFO cost recalculation';

type VoucherType = 'invoice' | 'credit_note' | 'stock_adjustment' | 'inter_branch_receipt';

export interface RecostLine {
  voucherType: VoucherType;
  voucherId: string;
  reference: string | null;
  date: string;
  posted: number;
  expected: number;
  delta: number;
}

export interface RecostReport {
  checked: number;
  changed: RecostLine[];
  skippedLocked: RecostLine[];
  skippedNoAccount: RecostLine[];
  dryRun: boolean;
}

interface Candidate {
  voucherType: VoucherType;
  voucherId: string;
  reference: string | null;
  date: string;
  /** Cost leaves inventory (invoice, loss adjustment) vs comes back (credit note, transfer receipt). */
  outward: boolean;
  expected: number;
}

/** Goods items (bundles → components) on the given invoices and credit notes. */
async function itemsOnDocuments(client: PoolClient, invoiceIds: string[], noteIds: string[]): Promise<string[]> {
  if (invoiceIds.length === 0 && noteIds.length === 0) return [];
  const r = await client.query<{ item_id: string }>(
    `SELECT DISTINCT x.item_id FROM (
       SELECT l.item_id FROM invoice_items l WHERE l.invoice_id = ANY($1::uuid[])
       UNION SELECT bi.item_id FROM invoice_items l JOIN bundle_items bi ON bi.bundle_id = l.item_id WHERE l.invoice_id = ANY($1::uuid[])
       UNION SELECT l.item_id FROM credit_note_items l WHERE l.credit_note_id = ANY($2::uuid[])
       UNION SELECT bi.item_id FROM credit_note_items l JOIN bundle_items bi ON bi.bundle_id = l.item_id WHERE l.credit_note_id = ANY($2::uuid[])
     ) x
     JOIN items it ON it.id = x.item_id AND it.item_type = 'goods' AND NOT COALESCE(it.is_bundle, false)`,
    [invoiceIds, noteIds]
  );
  return r.rows.map((x) => x.item_id);
}

/**
 * Re-runs FIFO for the items and corrects every posted voucher whose inventory cost differs
 * from the replay: a balancing pair (Inventory 1104 against COGS 5104, the adjustment's
 * counter account, or the inter-branch purchases account) is added inside the original
 * voucher on its own date. Vouchers dated before `fromDate` or in a locked period are left alone.
 */
export async function recostItems(
  client: PoolClient,
  businessId: string,
  itemIds: string[],
  opts: { fromDate?: string | null; dryRun?: boolean } = {}
): Promise<RecostReport> {
  const report: RecostReport = { checked: 0, changed: [], skippedLocked: [], skippedNoAccount: [], dryRun: !!opts.dryRun };
  const base = [...new Set(itemIds.filter(Boolean))];
  if (base.length === 0) return report;
  const inRange = (d: string) => !opts.fromDate || d >= opts.fromDate;

  const first = await replayCostItems(client, businessId, base);
  const invoiceIds = new Set<string>();
  const noteIds = new Set<string>();
  for (const list of first.movements.values()) {
    for (const m of list) {
      if (!inRange(m.date)) continue;
      if (m.kind === 'invoice') invoiceIds.add(m.docId);
      if (m.kind === 'credit_note') noteIds.add(m.docId);
    }
  }
  const all = [...new Set([...base, ...(await itemsOnDocuments(client, [...invoiceIds], [...noteIds]))])];
  await lockCostItems(client, businessId, all);
  const { movements, replays } = await replayCostItems(client, businessId, all);

  const candidates = new Map<string, Candidate>();
  for (const [itemId, list] of movements) {
    const replay = replays.get(itemId)!;
    for (const m of list) {
      if (!inRange(m.date)) continue;
      let voucherType: VoucherType;
      let outward: boolean;
      if (m.kind === 'invoice') [voucherType, outward] = ['invoice', true];
      else if (m.kind === 'credit_note') [voucherType, outward] = ['credit_note', false];
      else if (m.kind === 'adjustment_out') [voucherType, outward] = ['stock_adjustment', true];
      else continue;
      const cost = replay.results.get(m.key)?.cost ?? 0;
      const key = `${voucherType}:${m.docId}`;
      const c = candidates.get(key) ?? {
        voucherType, voucherId: m.docId, reference: m.docNumber ?? null, date: m.date, outward, expected: 0,
      };
      c.expected += cost;
      candidates.set(key, c);
      if (m.kind === 'invoice' && m.peek) {
        const rk = `inter_branch_receipt:${m.docId}`;
        const rc = candidates.get(rk) ?? {
          voucherType: 'inter_branch_receipt' as const, voucherId: m.docId, reference: m.docNumber ?? null, date: m.date, outward: false, expected: 0,
        };
        rc.expected += cost;
        candidates.set(rk, rc);
      }
    }
  }
  if (candidates.size === 0) return report;

  const list = [...candidates.values()];
  const posted = await client.query<{
    voucher_type: VoucherType; voucher_id: string; net_out: string; branch_id: string | null; entry_date: string;
  }>(
    `SELECT l.voucher_type, l.voucher_id,
            COALESCE(SUM(CASE WHEN a.account_code = '1104' THEN l.credit - l.debit ELSE 0 END), 0) AS net_out,
            MAX(l.branch_id::text) AS branch_id,
            to_char(MIN(l.entry_date), 'YYYY-MM-DD') AS entry_date
       FROM ledger_entry_lines l
       JOIN accounts a ON a.id = l.account_id
       JOIN unnest($2::text[], $3::uuid[]) AS v(t, id) ON v.t = l.voucher_type AND v.id = l.voucher_id
      WHERE l.business_id = $1
      GROUP BY l.voucher_type, l.voucher_id`,
    [businessId, list.map((c) => c.voucherType), list.map((c) => c.voucherId)]
  );
  const postedBy = new Map(posted.rows.map((p) => [`${p.voucher_type}:${p.voucher_id}`, p]));

  const accounts = await client.query<{ account_code: string; id: string }>(
    `SELECT account_code, id FROM accounts WHERE business_id = $1 AND account_code IN ('1104', '5104') AND is_active = true`,
    [businessId]
  );
  const inventory = accounts.rows.find((a) => a.account_code === '1104')?.id;
  const cogs = accounts.rows.find((a) => a.account_code === '5104')?.id;

  for (const c of list) {
    const p = postedBy.get(`${c.voucherType}:${c.voucherId}`);
    // Transfer receipts are booked only when goods arrive; nothing to correct before that.
    if (!p && c.voucherType === 'inter_branch_receipt') continue;
    report.checked += 1;
    const netOut = Number(p?.net_out) || 0;
    const current = round2(c.outward ? netOut : -netOut);
    const expected = round2(c.expected);
    const delta = round2(expected - current);
    if (Math.abs(delta) < 0.01) continue;
    const line: RecostLine = {
      voucherType: c.voucherType, voucherId: c.voucherId, reference: c.reference, date: c.date,
      posted: current, expected, delta,
    };

    const branchId = p?.branch_id ?? null;
    const locked = await client.query<{ locked: boolean }>(
      'SELECT is_period_locked($1::uuid, $2::uuid, $3::date) AS locked',
      [businessId, branchId, c.date]
    );
    if (locked.rows[0]?.locked) {
      report.skippedLocked.push(line);
      continue;
    }

    const counter = await counterAccount(client, businessId, c.voucherType, c.voucherId, cogs);
    if (!inventory || !counter) {
      report.skippedNoAccount.push(line);
      continue;
    }
    report.changed.push(line);
    if (opts.dryRun) continue;

    const inventoryCredit = c.outward ? delta : -delta;
    const amount = Math.abs(delta);
    const narration = `${RECOST_NARRATION} - ${c.reference ?? c.voucherId.slice(0, 8)}`.slice(0, 500);
    const lines: VoucherLine[] =
      inventoryCredit > 0
        ? [
            { accountId: counter, debit: amount, credit: 0, narration },
            { accountId: inventory, debit: 0, credit: amount, narration },
          ]
        : [
            { accountId: inventory, debit: amount, credit: 0, narration },
            { accountId: counter, debit: 0, credit: amount, narration },
          ];
    await insertVoucherLines(client, {
      businessId,
      branchId,
      voucherId: c.voucherId,
      voucherType: c.voucherType,
      entryDate: c.date,
      reference: c.reference,
      lines,
    });
  }
  return report;
}

async function counterAccount(
  client: PoolClient,
  businessId: string,
  voucherType: VoucherType,
  voucherId: string,
  cogs: string | undefined
): Promise<string | null> {
  if (voucherType === 'invoice' || voucherType === 'credit_note') return cogs ?? null;
  const r = await client.query<{ account_id: string }>(
    voucherType === 'stock_adjustment'
      ? `SELECT l.account_id FROM ledger_entry_lines l JOIN accounts a ON a.id = l.account_id
          WHERE l.business_id = $1 AND l.voucher_type = 'stock_adjustment' AND l.voucher_id = $2
            AND a.account_code <> '1104' AND l.debit > 0
          ORDER BY l.created_at LIMIT 1`
      : `SELECT l.account_id FROM ledger_entry_lines l JOIN accounts a ON a.id = l.account_id
          WHERE l.business_id = $1 AND l.voucher_type = 'inter_branch_receipt' AND l.voucher_id = $2
            AND a.account_code <> '1104' AND l.credit > 0 AND l.narration LIKE 'Stock received%'
          ORDER BY l.created_at LIMIT 1`,
    [businessId, voucherId]
  );
  if (r.rows[0]) return r.rows[0].account_id;
  if (voucherType !== 'stock_adjustment') return null;
  const adj = await client.query<{ reason_code: AdjustmentReason }>(
    'SELECT reason_code FROM inventory_adjustments WHERE id = $1 AND business_id = $2',
    [voucherId, businessId]
  );
  if (!adj.rows[0]) return null;
  for (const code of counterAccountCodes(adj.rows[0].reason_code, true)) {
    const id = await accountIdByCode(client, businessId, code);
    if (id) return id;
  }
  return null;
}

/**
 * Cut-over date for automatic recosting. `undefined` when the column does not exist yet
 * (migration 333 not applied) so callers skip recosting rather than restating all history.
 */
export async function getRecostFrom(client: Pick<PoolClient, 'query'>, businessId: string): Promise<string | null | undefined> {
  const r = await client.query<{ present: boolean; d: string | null }>(
    `SELECT (to_jsonb(bs) ? 'fifo_recost_from') AS present, to_jsonb(bs) ->> 'fifo_recost_from' AS d
       FROM business_settings bs WHERE business_id = $1`,
    [businessId]
  );
  const row = r.rows[0];
  if (!row || !row.present) return undefined;
  return row.d ? row.d.slice(0, 10) : null;
}

/**
 * Called by posting code after a stock document changes. FIFO businesses only; runs in a
 * savepoint so a recost failure never blocks the document, which already carries its own cost.
 */
export async function recostAfterStockChange(
  client: PoolClient,
  businessId: string,
  itemIds: string[]
): Promise<RecostReport | null> {
  const ids = [...new Set(itemIds.filter(Boolean))];
  if (ids.length === 0) return null;
  try {
    await client.query('SAVEPOINT fifo_recost');
  } catch {
    return null;
  }
  try {
    let report: RecostReport | null = null;
    if ((await getValuationMethod(client, businessId)) === 'fifo') {
      const from = await getRecostFrom(client, businessId);
      if (from !== undefined) report = await recostItems(client, businessId, ids, { fromDate: from });
    }
    await client.query('RELEASE SAVEPOINT fifo_recost');
    return report;
  } catch (e) {
    await client.query('ROLLBACK TO SAVEPOINT fifo_recost').catch(() => {});
    await client.query('RELEASE SAVEPOINT fifo_recost').catch(() => {});
    console.error('[fifo-recost] skipped:', (e as Error)?.message);
    return null;
  }
}

/** Goods item ids affected by a stock document (bundles expanded). */
export async function stockItemsForDocument(
  client: Pick<PoolClient, 'query'>,
  kind: 'invoice' | 'credit_note' | 'purchase' | 'purchase_return',
  docId: string
): Promise<string[]> {
  const src = {
    invoice: ['invoice_items', 'invoice_id'],
    credit_note: ['credit_note_items', 'credit_note_id'],
    purchase: ['purchase_items', 'purchase_id'],
    purchase_return: ['purchase_return_items', 'return_id'],
  }[kind];
  const r = await client.query<{ item_id: string }>(
    `SELECT DISTINCT x.item_id FROM (
       SELECT l.item_id FROM ${src[0]} l WHERE l.${src[1]} = $1
       UNION SELECT bi.item_id FROM ${src[0]} l JOIN bundle_items bi ON bi.bundle_id = l.item_id WHERE l.${src[1]} = $1
     ) x
     JOIN items it ON it.id = x.item_id AND it.item_type = 'goods' AND NOT COALESCE(it.is_bundle, false)`,
    [docId]
  );
  return r.rows.map((x) => x.item_id);
}
