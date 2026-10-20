import { queryOne, queryRows } from '@/lib/db';

/**
 * Day-book rows for the Ledger screen and account statements.
 *
 * Posted vouchers live in ledger_entry_lines. Manual journals are written there
 * and also mirrored into the older ledger_entries table. This read uses the lines
 * as the source of truth, then adds ledger_entries rows that have no matching line
 * so a manual entry that was stored only in the old table still appears once.
 */
export type LedgerRegisterRow = {
  id: string;
  entry_date: string;
  account_id: string;
  account_code: string | null;
  account_name: string | null;
  account_nature: 'debit' | 'credit' | null;
  voucher_id: string | null;
  voucher_type: string | null;
  voucher_number: string | null;
  reference_number: string | null;
  narration: string | null;
  debit: string;
  credit: string;
  branch_id: string | null;
  source: 'line' | 'legacy';
};

export type LedgerRegisterQuery = {
  businessId: string;
  accountId?: string | null;
  fromDate?: string | null;
  toDate?: string | null;
  /** entry_date strictly before this day. Used for opening balance; ignores from/to. */
  beforeDate?: string | null;
  voucherType?: string | null;
  /** When set, keep these branches and business-level rows (branch_id IS NULL). */
  branchIds?: string[] | null;
  order?: 'asc' | 'desc';
  page?: number;
  limit?: number | null;
};

function unifiedSql(q: LedgerRegisterQuery, params: unknown[]): string {
  params.push(q.businessId);
  const business = `$${params.length}`;

  const lineFilters: string[] = [];
  const legacyFilters: string[] = [];

  const add = (column: string, value: unknown) => {
    params.push(value);
    const ref = `$${params.length}`;
    lineFilters.push(`lel.${column} = ${ref}`);
    legacyFilters.push(`le.${column} = ${ref}`);
  };

  if (q.accountId) add('account_id', q.accountId);

  if (q.beforeDate) {
    params.push(q.beforeDate);
    const ref = `$${params.length}`;
    lineFilters.push(`lel.entry_date < ${ref}`);
    legacyFilters.push(`le.entry_date < ${ref}`);
  } else {
    if (q.fromDate) {
      params.push(q.fromDate);
      const ref = `$${params.length}`;
      lineFilters.push(`lel.entry_date >= ${ref}`);
      legacyFilters.push(`le.entry_date >= ${ref}`);
    }
    if (q.toDate) {
      params.push(q.toDate);
      const ref = `$${params.length}`;
      lineFilters.push(`lel.entry_date <= ${ref}`);
      legacyFilters.push(`le.entry_date <= ${ref}`);
    }
  }

  if (q.voucherType) {
    params.push(q.voucherType);
    const ref = `$${params.length}`;
    lineFilters.push(`lel.voucher_type = ${ref}`);
    legacyFilters.push(`COALESCE(le.voucher_type, le.transaction_type) = ${ref}`);
  }

  if (q.branchIds && q.branchIds.length > 0) {
    params.push(q.branchIds);
    const ref = `$${params.length}::uuid[]`;
    lineFilters.push(`(lel.branch_id = ANY(${ref}) OR lel.branch_id IS NULL)`);
    legacyFilters.push(`(le.branch_id = ANY(${ref}) OR le.branch_id IS NULL)`);
  }

  const lineWhere = lineFilters.length ? ` AND ${lineFilters.join(' AND ')}` : '';
  const legacyWhere = legacyFilters.length ? ` AND ${legacyFilters.join(' AND ')}` : '';

  return `
    SELECT
      lel.id,
      lel.entry_date,
      lel.account_id,
      a.account_code,
      a.account_name,
      a.nature AS account_nature,
      lel.voucher_id::text AS voucher_id,
      lel.voucher_type,
      je.voucher_number,
      lel.reference_number,
      lel.narration,
      lel.debit,
      lel.credit,
      lel.branch_id,
      lel.created_at,
      'line'::text AS source
    FROM ledger_entry_lines lel
    LEFT JOIN accounts a ON a.id = lel.account_id
    LEFT JOIN journal_entries je
      ON je.business_id = lel.business_id
     AND je.voucher_id = lel.voucher_id
     AND lel.voucher_type = 'journal'
    WHERE lel.business_id = ${business}${lineWhere}
    UNION ALL
    SELECT
      le.id,
      le.entry_date,
      le.account_id,
      a.account_code,
      a.account_name,
      a.nature AS account_nature,
      le.transaction_id::text AS voucher_id,
      COALESCE(le.voucher_type, le.transaction_type) AS voucher_type,
      le.voucher_number,
      le.reference_number,
      le.description AS narration,
      le.debit,
      le.credit,
      le.branch_id,
      le.created_at,
      'legacy'::text AS source
    FROM ledger_entries le
    LEFT JOIN accounts a ON a.id = le.account_id
    WHERE le.business_id = ${business}${legacyWhere}
      AND NOT EXISTS (
        SELECT 1 FROM ledger_entry_lines match
        WHERE match.business_id = le.business_id
          AND match.account_id = le.account_id
          AND match.voucher_id = le.transaction_id
          AND match.entry_date = le.entry_date
          AND match.debit = le.debit
          AND match.credit = le.credit
      )
  `;
}

export async function listLedgerRegister(
  q: LedgerRegisterQuery
): Promise<{ entries: LedgerRegisterRow[]; total: number }> {
  const params: unknown[] = [];
  const unified = unifiedSql(q, params);
  const order = q.order === 'asc' ? 'ASC' : 'DESC';

  if (q.limit == null) {
    const entries = await queryRows<LedgerRegisterRow>(
      `SELECT * FROM (${unified}) register ORDER BY entry_date ${order}, created_at ${order}, id ${order}`,
      params
    );
    return { entries, total: entries.length };
  }

  const page = Math.max(1, q.page || 1);
  const limit = Math.min(200, Math.max(1, q.limit));
  const offset = (page - 1) * limit;
  params.push(limit, offset);
  const limitRef = params.length - 1;
  const offsetRef = params.length;

  const rows = await queryRows<LedgerRegisterRow & { total_count: string }>(
    `SELECT register.*, COUNT(*) OVER() AS total_count
       FROM (${unified}) register
      ORDER BY entry_date ${order}, created_at ${order}, id ${order}
      LIMIT $${limitRef} OFFSET $${offsetRef}`,
    params
  );
  const total = rows.length ? Number(rows[0].total_count) || 0 : 0;
  return {
    entries: rows.map(({ total_count: _total, ...row }) => row),
    total,
  };
}

export async function sumLedgerRegister(
  q: LedgerRegisterQuery
): Promise<{ debit: number; credit: number }> {
  const params: unknown[] = [];
  const unified = unifiedSql(q, params);
  const row = await queryOne<{ debit: string; credit: string }>(
    `SELECT COALESCE(SUM(debit), 0)::text AS debit, COALESCE(SUM(credit), 0)::text AS credit
       FROM (${unified}) register`,
    params
  );
  return {
    debit: Number(row?.debit || 0),
    credit: Number(row?.credit || 0),
  };
}

export function signedLedgerBalance(
  nature: string | null | undefined,
  debit: number,
  credit: number
): number {
  return nature === 'credit' ? credit - debit : debit - credit;
}
