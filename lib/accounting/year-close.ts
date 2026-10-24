import type { PoolClient } from 'pg';
import {
  deleteVoucher,
  insertVoucherLines,
  requireAccountByCode,
  round2,
  type VoucherLine,
} from '@/lib/accounting/voucher-posting';

export const YEAR_CLOSE_VOUCHER = 'year_close';

export type PnlBalance = { account_id: string; account_code: string; account_type: 'income' | 'expense'; net: number };

/**
 * Closing lines that zero every income and expense account (net = debit - credit for the
 * FY) and put the difference to Retained Earnings. Profit credits RE; loss debits it.
 */
export function buildClosingLines(
  balances: PnlBalance[],
  retainedEarningsId: string,
  label: string
): { lines: VoucherLine[]; profit: number } {
  const lines: VoucherLine[] = [];
  let net = 0;
  for (const b of balances) {
    const amt = round2(b.net);
    if (amt === 0) continue;
    net = round2(net + amt);
    lines.push(
      amt > 0
        ? { accountId: b.account_id, debit: 0, credit: amt, narration: label }
        : { accountId: b.account_id, debit: -amt, credit: 0, narration: label }
    );
  }
  const profit = round2(-net);
  if (profit > 0) lines.push({ accountId: retainedEarningsId, debit: 0, credit: profit, narration: label });
  else if (profit < 0) lines.push({ accountId: retainedEarningsId, debit: -profit, credit: 0, narration: label });
  return { lines, profit };
}

/**
 * Posts the closing voucher for the FY on the caller's transaction (replacing any earlier
 * one for the same year) and returns the profit transferred.
 */
export async function postYearClosingVoucher(
  client: PoolClient,
  p: { businessId: string; financialYearId: string; yearCode: string; startDate: string; endDate: string }
): Promise<{ profit: number; lines: number }> {
  await deleteVoucher(client, p.businessId, p.financialYearId, YEAR_CLOSE_VOUCHER, 'regenerate:year_close', null);
  const res = await client.query<{ account_id: string; account_code: string; account_type: 'income' | 'expense'; net: string }>(
    `SELECT a.id AS account_id, a.account_code, a.account_type,
            COALESCE(SUM(l.debit - l.credit), 0) AS net
       FROM accounts a
       JOIN ledger_entry_lines l ON l.account_id = a.id
      WHERE a.business_id = $1
        AND a.account_type IN ('income', 'expense')
        AND l.entry_date >= $2::date AND l.entry_date <= $3::date
        AND l.voucher_type <> $4
      GROUP BY a.id, a.account_code, a.account_type
      ORDER BY a.account_code`,
    [p.businessId, p.startDate, p.endDate, YEAR_CLOSE_VOUCHER]
  );
  const re = await requireAccountByCode(client, p.businessId, '3002', 'Retained Earnings');
  const { lines, profit } = buildClosingLines(
    res.rows.map((r) => ({ ...r, net: Number(r.net) })),
    re,
    `Year closing FY ${p.yearCode}: P&L transferred to Retained Earnings`
  );
  if (lines.length === 0) return { profit: 0, lines: 0 };
  await insertVoucherLines(client, {
    businessId: p.businessId,
    branchId: null,
    voucherId: p.financialYearId,
    voucherType: YEAR_CLOSE_VOUCHER,
    entryDate: p.endDate,
    reference: `YC-${p.yearCode}`,
    lines,
  });
  return { profit, lines: lines.length };
}
