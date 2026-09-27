import type { PoolClient } from 'pg';

export const REVERSAL_NARRATION_PREFIX = 'Reversal:';

/**
 * Posts mirror lines (debit ↔ credit) for every line of a voucher, under the same voucher id,
 * so the voucher nets to zero and stays balanced for the deferred voucher-balance trigger.
 * Idempotent: a voucher that already carries reversal lines is left alone.
 */
export async function reverseVoucherLedgerEntries(
  client: PoolClient,
  opts: {
    businessId: string;
    voucherType: string;
    voucherId: string;
    reason: string;
    entryDate?: string | Date | null;
  }
): Promise<number> {
  const lines = await client.query(
    `SELECT account_id, entry_date, debit, credit, narration, reference_number, branch_id
       FROM ledger_entry_lines
      WHERE business_id = $1 AND voucher_type = $2 AND voucher_id = $3`,
    [opts.businessId, opts.voucherType, opts.voucherId]
  );
  if (lines.rows.length === 0) return 0;
  if (lines.rows.some((l) => String(l.narration || '').startsWith(REVERSAL_NARRATION_PREFIX))) return 0;

  for (const l of lines.rows) {
    await client.query(
      `INSERT INTO ledger_entry_lines (
         business_id, voucher_id, voucher_type, account_id, entry_date,
         debit, credit, narration, reference_number, branch_id
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        opts.businessId,
        opts.voucherId,
        opts.voucherType,
        l.account_id,
        opts.entryDate ?? l.entry_date,
        Number(l.credit) || 0,
        Number(l.debit) || 0,
        `${REVERSAL_NARRATION_PREFIX} ${opts.reason} (${l.narration || ''})`.slice(0, 500),
        l.reference_number,
        l.branch_id,
      ]
    );
  }
  return lines.rows.length;
}
