import type { PoolClient } from 'pg';
import { accountIdByCode, insertVoucherLines, round2, type VoucherLine } from '@/lib/accounting/voucher-posting';

export type AdjustmentReason =
  | 'STOCK_TAKE'
  | 'DAMAGE'
  | 'THEFT'
  | 'EXPIRED'
  | 'FREE_SAMPLE'
  | 'COST_CORRECTION'
  | 'LANDED_COST'
  | 'REVALUATION'
  | 'WRITE_DOWN';

/** s.17(5)(h): goods lost, stolen, destroyed, written off or given as free samples. */
export const ITC_REVERSAL_REASONS: ReadonlySet<AdjustmentReason> = new Set([
  'DAMAGE',
  'THEFT',
  'EXPIRED',
  'WRITE_DOWN',
  'FREE_SAMPLE',
]);

/** Ledger code for the non-inventory side of an adjustment, with fallbacks. */
export function counterAccountCodes(reason: AdjustmentReason, isDecrease: boolean): string[] {
  if (isDecrease) {
    if (reason === 'FREE_SAMPLE') return ['5202', '5201'];
    if (reason === 'LANDED_COST') return ['5105', '5101'];
    return ['5106', '5201'];
  }
  if (reason === 'LANDED_COST') return ['5105', '5101'];
  return ['4201'];
}

export function itcReversalSplit(
  valueAtCost: number,
  taxRate: number,
  interState: boolean
): { igst: number; cgst: number; sgst: number } {
  const total = round2((valueAtCost * taxRate) / 100);
  if (interState) return { igst: total, cgst: 0, sgst: 0 };
  const cgst = round2(total / 2);
  return { igst: 0, cgst, sgst: round2(total - cgst) };
}

async function firstAccount(client: PoolClient, businessId: string, codes: string[]): Promise<string | null> {
  for (const c of codes) {
    const id = await accountIdByCode(client, businessId, c);
    if (id) return id;
  }
  return null;
}

/**
 * Posts an inventory adjustment on the caller's transaction (errors propagate so
 * stock and books never diverge). Returns the ITC reversed, if any.
 */
export async function postInventoryAdjustment(
  client: PoolClient,
  p: {
    businessId: string;
    branchId: string | null;
    adjustmentId: string;
    adjustmentNumber: string;
    date: string;
    reason: AdjustmentReason;
    isDecrease: boolean;
    amount: number;
    itemId: string;
    narration: string;
    quantityAdjustment: boolean;
  }
): Promise<{ itcReversed: number }> {
  const amount = round2(Math.abs(p.amount));
  if (amount === 0) return { itcReversed: 0 };

  const inventory = await accountIdByCode(client, p.businessId, '1104');
  const counter = await firstAccount(client, p.businessId, counterAccountCodes(p.reason, p.isDecrease));
  if (!inventory || !counter) {
    throw new Error('Inventory (1104) or stock adjustment ledger account not found; initialise the chart of accounts');
  }

  const lines: VoucherLine[] = p.isDecrease
    ? [
        { accountId: counter, debit: amount, credit: 0, narration: p.narration },
        { accountId: inventory, debit: 0, credit: amount, narration: p.narration },
      ]
    : [
        { accountId: inventory, debit: amount, credit: 0, narration: p.narration },
        { accountId: counter, debit: 0, credit: amount, narration: p.narration },
      ];
  await insertVoucherLines(client, {
    businessId: p.businessId,
    branchId: p.branchId,
    voucherId: p.adjustmentId,
    voucherType: 'stock_adjustment',
    entryDate: p.date,
    reference: p.adjustmentNumber,
    lines,
  });

  if (!(p.isDecrease && p.quantityAdjustment && ITC_REVERSAL_REASONS.has(p.reason))) {
    return { itcReversed: 0 };
  }

  const item = await client.query<{ tax_rate: string | null; item_type: string | null }>(
    `SELECT tax_rate, item_type FROM items WHERE id = $1 AND business_id = $2`,
    [p.itemId, p.businessId]
  );
  const rate = Number(item.rows[0]?.tax_rate || 0);
  if (!(rate > 0)) return { itcReversed: 0 };

  const lastBill = await client.query<{ igst: string }>(
    `SELECT COALESCE(pi.igst_amount, 0) AS igst
       FROM purchase_items pi
       JOIN purchases pu ON pu.id = pi.purchase_id
      WHERE pi.item_id = $1 AND pu.business_id = $2 AND pu.deleted_at IS NULL
        AND COALESCE(pu.status, '') NOT IN ('draft', 'cancelled')
        AND (pu.itc_eligible IS DISTINCT FROM false)
      ORDER BY pu.bill_date DESC, pu.created_at DESC
      LIMIT 1`,
    [p.itemId, p.businessId]
  );
  if (lastBill.rows.length === 0) return { itcReversed: 0 };
  const split = itcReversalSplit(amount, rate, Number(lastBill.rows[0].igst) > 0);

  const itcLines: VoucherLine[] = [];
  const label = `ITC reversed u/s 17(5)(h) - ${p.narration}`;
  const heads: Array<[number, string]> = [
    [split.igst, '1112'],
    [split.cgst, '1110'],
    [split.sgst, '1111'],
  ];
  let total = 0;
  for (const [amt, code] of heads) {
    if (amt <= 0) continue;
    const acc = await accountIdByCode(client, p.businessId, code);
    if (!acc) throw new Error(`Input GST account ${code} not found`);
    itcLines.push({ accountId: acc, debit: 0, credit: amt, narration: label });
    total = round2(total + amt);
  }
  if (total === 0) return { itcReversed: 0 };
  itcLines.unshift({ accountId: counter, debit: total, credit: 0, narration: label });
  await insertVoucherLines(client, {
    businessId: p.businessId,
    branchId: p.branchId,
    voucherId: p.adjustmentId,
    voucherType: 'itc_reversal',
    entryDate: p.date,
    reference: p.adjustmentNumber,
    lines: itcLines,
  });
  return { itcReversed: total };
}
