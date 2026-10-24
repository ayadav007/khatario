import type { PoolClient } from 'pg';
import { activeLedgerLineSql, reverseVoucherLedgerEntries } from '@/lib/ledger-reversal';
import { type JournalLineInput, toJournalAmount } from '@/lib/accounting/journal-lines';

type ActiveLine = {
  account_id: string;
  debit: string;
  credit: string;
  narration: string | null;
  entry_date: string | Date;
  reference_number: string | null;
  branch_id: string | null;
};

export async function activeJournalLines(client: PoolClient, businessId: string, voucherId: string): Promise<ActiveLine[]> {
  return (
    await client.query<ActiveLine>(
      `SELECT l.account_id, l.debit, l.credit, l.narration, l.entry_date, l.reference_number, l.branch_id
         FROM ledger_entry_lines l
        WHERE l.voucher_id = $1 AND l.business_id = $2 AND l.voucher_type = 'journal'
          AND ${activeLedgerLineSql('l')}
        ORDER BY l.created_at, l.id`,
      [voucherId, businessId]
    )
  ).rows;
}

/** Reverses the journal's current posting in ledger_entry_lines. Returns the number of lines reversed. */
async function reverseJournalPosting(
  client: PoolClient,
  p: { businessId: string; voucherId: string; userId: string; reason: string }
): Promise<number> {
  return reverseVoucherLedgerEntries(client, {
    businessId: p.businessId,
    voucherType: 'journal',
    voucherId: p.voucherId,
    reason: p.reason,
    actorId: p.userId,
  });
}

/**
 * Correction of a posted journal on the caller's transaction: original -> reversal (dated on
 * the original) -> corrected lines on `entryDate`, all under the same voucher.
 */
export async function repostJournal(
  client: PoolClient,
  p: {
    businessId: string;
    voucherId: string;
    userId: string;
    branchId: string | null;
    entryDate: string | Date;
    lines: JournalLineInput[];
    narration: string | null;
    reference: string | null;
    voucherNumber: string | null;
  }
): Promise<{ reversed: number; posted: number }> {
  const reversed = await reverseJournalPosting(client, {
    businessId: p.businessId,
    voucherId: p.voucherId,
    userId: p.userId,
    reason: 'Journal corrected',
  });
  let posted = 0;
  for (const line of p.lines) {
    const d = toJournalAmount(line.debit);
    const c = toJournalAmount(line.credit);
    const lineNarration = line.narration || p.narration || null;
    await client.query(
      `INSERT INTO ledger_entry_lines (
         business_id, voucher_id, voucher_type, account_id, entry_date,
         debit, credit, narration, reference_number, branch_id
       ) VALUES ($1, $2, 'journal', $3, $4, $5, $6, $7, $8, $9)`,
      [p.businessId, p.voucherId, line.account_id, p.entryDate, d, c, lineNarration, p.reference, p.branchId]
    );
    posted++;
  }
  return { reversed, posted };
}

const hasActiveJournalLineSql = (voucherId: string, businessId: string) =>
  `EXISTS (SELECT 1 FROM ledger_entry_lines a
            WHERE a.business_id = ${businessId} AND a.voucher_type = 'journal' AND a.voucher_id = ${voucherId}
              AND ${activeLedgerLineSql('a')})`;

/** True for a journal whose posting has been fully reversed: it has reversal links and no active lines. */
export function journalIsReversedSql(voucherId: string, businessId: string): string {
  return `(NOT ${hasActiveJournalLineSql(voucherId, businessId)}
      AND EXISTS (SELECT 1 FROM ledger_entry_reversals r
                   WHERE r.business_id = ${businessId} AND r.voucher_type = 'journal' AND r.voucher_id = ${voucherId}))`;
}

/**
 * Lines of `alias` that show a journal's posting: its active lines or, once fully reversed, the
 * original lines of its last reversal. Links written by one reversal share the transaction
 * timestamp, so earlier correction reversals are not shown.
 */
export function journalDisplayLineSql(alias: string): string {
  return `(${activeLedgerLineSql(alias)}
      OR (NOT ${hasActiveJournalLineSql(`${alias}.voucher_id`, `${alias}.business_id`)}
          AND EXISTS (SELECT 1 FROM ledger_entry_reversals x
                       WHERE x.original_line_id = ${alias}.id
                         AND x.created_at = (SELECT MAX(y.created_at) FROM ledger_entry_reversals y
                                              WHERE y.business_id = ${alias}.business_id AND y.voucher_type = 'journal'
                                                AND y.voucher_id = ${alias}.voucher_id))))`;
}

export const JOURNAL_REVERSAL_REASON_PREFIX = 'Journal reversed:';

export type JournalReverseResult = 'reversed' | 'not_found' | 'already_reversed';

/**
 * Reversal of a posted journal on the caller's transaction: its current posting is reversed
 * under the same voucher, and the journal stays live as a reversed record.
 */
export async function reverseJournal(
  client: PoolClient,
  p: { businessId: string; voucherId: string; userId: string; reason: string }
): Promise<JournalReverseResult> {
  const head = await client.query<{ voucher_number: string | null }>(
    `SELECT voucher_number FROM journal_entries
      WHERE voucher_id = $1 AND business_id = $2 AND deleted_at IS NULL FOR UPDATE`,
    [p.voucherId, p.businessId]
  );
  if (head.rows.length === 0) return 'not_found';
  const reversed = await reverseJournalPosting(client, {
    businessId: p.businessId,
    voucherId: p.voucherId,
    userId: p.userId,
    reason: `${JOURNAL_REVERSAL_REASON_PREFIX} ${p.reason}`,
  });
  if (reversed === 0) return 'already_reversed';
  await client.query(
    `UPDATE journal_entries SET updated_by = $3, updated_at = CURRENT_TIMESTAMP
      WHERE voucher_id = $1 AND business_id = $2`,
    [p.voucherId, p.businessId, p.userId]
  );
  return 'reversed';
}

/**
 * Delete of a posted journal on the caller's transaction: its posting is reversed and the
 * header is soft-deleted (the number stays used). Returns false when already deleted.
 */
export async function deleteJournalByReversal(
  client: PoolClient,
  p: { businessId: string; voucherId: string; userId: string; reason: string | null }
): Promise<boolean> {
  const head = await client.query<{ voucher_number: string | null }>(
    `SELECT voucher_number FROM journal_entries
      WHERE voucher_id = $1 AND business_id = $2 AND deleted_at IS NULL FOR UPDATE`,
    [p.voucherId, p.businessId]
  );
  if (head.rows.length === 0) return false;
  await reverseJournalPosting(client, {
    businessId: p.businessId,
    voucherId: p.voucherId,
    userId: p.userId,
    reason: p.reason ? `Journal deleted: ${p.reason}` : 'Journal deleted',
  });
  await client.query(
    `UPDATE journal_entries
        SET deleted_at = CURRENT_TIMESTAMP, deleted_by = $3, delete_reason = $4, updated_at = CURRENT_TIMESTAMP
      WHERE voucher_id = $1 AND business_id = $2`,
    [p.voucherId, p.businessId, p.userId, p.reason || null]
  );
  return true;
}
