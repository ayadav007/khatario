import type { PoolClient } from 'pg';
import { activeLedgerLineSql, reverseVoucherLedgerEntries, REVERSAL_NARRATION_PREFIX } from '@/lib/ledger-reversal';
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

async function insertMirrorRow(
  client: PoolClient,
  r: {
    businessId: string;
    branchId: string | null;
    date: string | Date;
    accountId: string;
    voucherId: string;
    debit: number;
    credit: number;
    description: string;
    voucherNumber: string | null;
    reference: string | null;
  }
) {
  await client.query(
    `INSERT INTO ledger_entries (
       business_id, branch_id, entry_date, account_id, account_type, transaction_type,
       transaction_id, debit, credit, balance, description,
       voucher_number, voucher_type, reference_number
     ) VALUES ($1, $2, $3, $4, 'account', 'journal', $5, $6, $7, 0, $8, $9, 'journal', $10)`,
    [r.businessId, r.branchId, r.date, r.accountId, r.voucherId, r.debit, r.credit, r.description, r.voucherNumber, r.reference]
  );
}

/**
 * Reverses the journal's current posting in ledger_entry_lines (linked reversal lines) and
 * appends matching reversal rows to the legacy ledger_entries mirror, so both stay net-equal
 * without deleting anything. Returns the number of lines reversed.
 */
async function reverseJournalPosting(
  client: PoolClient,
  p: { businessId: string; voucherId: string; userId: string; reason: string; voucherNumber: string | null }
): Promise<number> {
  const active = await activeJournalLines(client, p.businessId, p.voucherId);
  const n = await reverseVoucherLedgerEntries(client, {
    businessId: p.businessId,
    voucherType: 'journal',
    voucherId: p.voucherId,
    reason: p.reason,
    actorId: p.userId,
  });
  for (const l of active) {
    await insertMirrorRow(client, {
      businessId: p.businessId,
      branchId: l.branch_id,
      date: l.entry_date,
      accountId: l.account_id,
      voucherId: p.voucherId,
      debit: Number(l.credit) || 0,
      credit: Number(l.debit) || 0,
      description: `${REVERSAL_NARRATION_PREFIX} ${p.reason} (${l.narration || ''})`.slice(0, 500),
      voucherNumber: p.voucherNumber,
      reference: l.reference_number,
    });
  }
  return n;
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
    voucherNumber: p.voucherNumber,
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
    await insertMirrorRow(client, {
      businessId: p.businessId,
      branchId: p.branchId,
      date: p.entryDate,
      accountId: line.account_id as string,
      voucherId: p.voucherId,
      debit: d,
      credit: c,
      description: lineNarration || 'Journal Entry',
      voucherNumber: p.voucherNumber,
      reference: p.reference,
    });
    posted++;
  }
  return { reversed, posted };
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
    voucherNumber: head.rows[0].voucher_number,
  });
  await client.query(
    `UPDATE journal_entries
        SET deleted_at = CURRENT_TIMESTAMP, deleted_by = $3, delete_reason = $4, updated_at = CURRENT_TIMESTAMP
      WHERE voucher_id = $1 AND business_id = $2`,
    [p.voucherId, p.businessId, p.userId, p.reason || null]
  );
  return true;
}
