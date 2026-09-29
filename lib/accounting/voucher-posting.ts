import type { PoolClient } from 'pg';
import { withLedgerDelete, type LedgerDeleteReason } from '@/lib/accounting/ledger-delete-guard';

export type VoucherLine = { accountId: string; debit: number; credit: number; narration: string };

export const round2 = (n: number) => Math.round(n * 100) / 100;

export async function accountIdByCode(
  client: PoolClient,
  businessId: string,
  code: string
): Promise<string | null> {
  const res = await client.query<{ id: string }>(
    `SELECT id FROM accounts WHERE business_id = $1 AND account_code = $2 AND is_active = true LIMIT 1`,
    [businessId, code]
  );
  return res.rows[0]?.id ?? null;
}

export async function requireAccountByCode(
  client: PoolClient,
  businessId: string,
  code: string,
  name: string
): Promise<string> {
  const id = await accountIdByCode(client, businessId, code);
  if (!id) throw new Error(`${name} (${code}) account not found; initialise the chart of accounts`);
  return id;
}

/**
 * Inserts a balanced voucher inside the caller's transaction. Zero lines are
 * skipped; same-account lines are not netted.
 */
export async function insertVoucherLines(
  client: PoolClient,
  p: {
    businessId: string;
    branchId: string | null;
    voucherId: string;
    voucherType: string;
    entryDate: string | Date;
    reference: string | null;
    lines: VoucherLine[];
  }
): Promise<void> {
  const dr = round2(p.lines.reduce((s, l) => s + round2(l.debit), 0));
  const cr = round2(p.lines.reduce((s, l) => s + round2(l.credit), 0));
  if (Math.abs(dr - cr) > 0.001) {
    throw new Error(`Voucher not balanced (Dr ${dr} / Cr ${cr})`);
  }
  for (const l of p.lines) {
    const d = round2(l.debit);
    const c = round2(l.credit);
    if (d === 0 && c === 0) continue;
    if (d < 0 || c < 0) throw new Error('Voucher lines cannot be negative');
    await client.query(
      `INSERT INTO ledger_entry_lines (
         business_id, voucher_id, voucher_type, account_id, entry_date,
         debit, credit, narration, reference_number, branch_id
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [p.businessId, p.voucherId, p.voucherType, l.accountId, p.entryDate, d, c, l.narration, p.reference, p.branchId]
    );
  }
}

export async function deleteVoucher(
  client: PoolClient,
  businessId: string,
  voucherId: string,
  voucherType: string,
  reason: LedgerDeleteReason,
  actorId: string | null
): Promise<void> {
  await withLedgerDelete(client, reason, actorId, () =>
    client.query(
      `DELETE FROM ledger_entry_lines WHERE business_id = $1 AND voucher_id = $2 AND voucher_type = $3`,
      [businessId, voucherId, voucherType]
    )
  );
}
