import type { PoolClient } from 'pg';

/** Display prefix only; reversal state lives in ledger_entry_reversals (migration 324). */
export const REVERSAL_NARRATION_PREFIX = 'Reversal:';

/**
 * SQL predicate for lines of `alias` that make up a voucher's current posting: not reversed
 * and not themselves reversals.
 */
export function activeLedgerLineSql(alias: string): string {
  return `NOT EXISTS (SELECT 1 FROM ledger_entry_reversals ler_o WHERE ler_o.original_line_id = ${alias}.id)
      AND NOT EXISTS (SELECT 1 FROM ledger_entry_reversals ler_r WHERE ler_r.reversal_line_id = ${alias}.id)`;
}

/**
 * Posts a mirror line (debit ↔ credit) for every line of the voucher's current posting, under
 * the same voucher id, and links each pair in ledger_entry_reversals. Lines already reversed,
 * and reversal lines, are skipped, so repeated calls never compound; a voucher re-posted after
 * a reversal is reversed again for the new lines only. Reversal lines keep the original line's
 * date unless `entryDate` is given.
 *
 * A customer can be moved from one receivable account to another (Domestic Debtors to Foreign
 * Debtors); the balance is transferred once and the old account is then settled for that
 * customer. A reversal must mirror its original on the same account (migration 324 enforces it),
 * which would reopen the old account. So when an original was carried away by such a move, the
 * mirror's amount is carried to the customer's current account by a correction transfer dated
 * like the mirror (lib/accounting/receivable-account-move.ts).
 */
export async function reverseVoucherLedgerEntries(
  client: PoolClient,
  opts: {
    businessId: string;
    voucherType: string;
    voucherId: string;
    reason: string;
    entryDate?: string | Date | null;
    actorId?: string | null;
  }
): Promise<number> {
  const lines = await client.query(
    `SELECT l.id, l.account_id, l.entry_date, l.debit, l.credit, l.narration, l.reference_number, l.branch_id
       FROM ledger_entry_lines l
      WHERE l.business_id = $1 AND l.voucher_type = $2 AND l.voucher_id = $3
        AND ${activeLedgerLineSql('l')}
      ORDER BY l.created_at, l.id
      FOR UPDATE OF l`,
    [opts.businessId, opts.voucherType, opts.voucherId]
  );

  const { customerSweptLines, postReceivableCorrection } = await import('@/lib/accounting/receivable-account-move');
  const receivable = await customerSweptLines(client, {
    businessId: opts.businessId,
    voucherType: opts.voucherType,
    voucherId: opts.voucherId,
    lines: lines.rows.map((l) => ({ id: l.id as string, account_id: l.account_id as string })),
  });
  const strays: Array<{
    accountId: string;
    branchId: string | null;
    entryDate: string | Date;
    debit: number;
    credit: number;
  }> = [];

  for (const l of lines.rows) {
    const ins = await client.query<{ id: string }>(
      `INSERT INTO ledger_entry_lines (
         business_id, voucher_id, voucher_type, account_id, entry_date,
         debit, credit, narration, reference_number, branch_id
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING id`,
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
    await client.query(
      `INSERT INTO ledger_entry_reversals (
         original_line_id, reversal_line_id, business_id, voucher_type, voucher_id, reason, created_by
       ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [l.id, ins.rows[0].id, opts.businessId, opts.voucherType, opts.voucherId, opts.reason.slice(0, 500), opts.actorId ?? null]
    );
    if (receivable?.sweptLineIds.has(l.id)) {
      strays.push({
        accountId: l.account_id,
        branchId: l.branch_id ?? null,
        entryDate: opts.entryDate ?? l.entry_date,
        debit: Number(l.debit) || 0,
        credit: Number(l.credit) || 0,
      });
    }
  }

  if (receivable && strays.length > 0) {
    await postReceivableCorrection(client, {
      businessId: opts.businessId,
      customerId: receivable.customerId,
      toAccountId: receivable.currentAccountId,
      sourceVoucherType: opts.voucherType,
      sourceVoucherId: opts.voucherId,
      actorId: opts.actorId ?? null,
      reversedLines: strays,
    });
  }
  return lines.rows.length;
}

/** Reverses the current posting of each voucher; returns the number of lines reversed. */
export async function reverseVouchers(
  client: PoolClient,
  opts: {
    businessId: string;
    voucherType: string;
    voucherIds: string[];
    reason: string;
    entryDate?: string | Date | null;
    actorId?: string | null;
  }
): Promise<number> {
  let n = 0;
  for (const voucherId of opts.voucherIds) {
    n += await reverseVoucherLedgerEntries(client, { ...opts, voucherId });
  }
  return n;
}

/** True when the voucher has lines that are neither reversed nor reversals. */
export async function hasActivePosting(
  client: PoolClient,
  businessId: string,
  voucherType: string,
  voucherId: string
): Promise<boolean> {
  const res = await client.query(
    `SELECT 1 FROM ledger_entry_lines l
      WHERE l.business_id = $1 AND l.voucher_type = $2 AND l.voucher_id = $3
        AND ${activeLedgerLineSql('l')}
      LIMIT 1`,
    [businessId, voucherType, voucherId]
  );
  return res.rows.length > 0;
}
