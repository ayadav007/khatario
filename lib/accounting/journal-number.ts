import type { PoolClient } from 'pg';

export function journalYear(entryDate: string | Date): string {
  if (entryDate instanceof Date) return String(entryDate.getFullYear());
  return String(entryDate).slice(0, 4);
}

export function formatJournalNumber(year: string, seq: number): string {
  return `JRN/${year}/${String(seq).padStart(6, '0')}`;
}

/**
 * Next JRN/YYYY/nnnnnn number. Serialised per business with a transaction-scoped
 * advisory lock and counted over journal_entries (soft-deleted rows included), so
 * a deleted journal never frees its number for reuse. Must run inside BEGIN.
 */
export async function allocateJournalVoucherNumber(
  client: PoolClient,
  businessId: string,
  entryDate: string | Date
): Promise<string> {
  const year = journalYear(entryDate);
  await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`journal-number:${businessId}`]);
  const res = await client.query<{ max_seq: number | null }>(
    `SELECT MAX(seq) AS max_seq FROM (
       SELECT CAST(SUBSTRING(voucher_number FROM '[0-9]+$') AS INTEGER) AS seq
         FROM journal_entries
        WHERE business_id = $1 AND voucher_number LIKE $2
       UNION ALL
       SELECT CAST(SUBSTRING(voucher_number FROM '[0-9]+$') AS INTEGER)
         FROM ledger_entries
        WHERE business_id = $1 AND voucher_type = 'journal' AND voucher_number LIKE $2
     ) s`,
    [businessId, `JRN/${year}/%`]
  );
  return formatJournalNumber(year, Number(res.rows[0]?.max_seq || 0) + 1);
}
