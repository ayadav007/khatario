export const RECENT_TX_FILTERS = ['all', 'invoice', 'purchase', 'payment', 'return', 'expense'] as const;

export type RecentTxFilter = (typeof RECENT_TX_FILTERS)[number];

export type RecentTransactionRow = {
  id: string;
  kind: string;
  doc_number: string;
  party: string;
  doc_date: string | Date | null;
  sort_at: string | Date;
  amount: number;
  status: string;
};

const KIND_FOR_FILTER: Record<RecentTxFilter, string[]> = {
  all: ['invoice', 'purchase', 'payment', 'return', 'expense'],
  invoice: ['invoice'],
  purchase: ['purchase'],
  payment: ['payment'],
  return: ['return'],
  expense: ['expense'],
};

function branchSql(alias: string, branchParam: number | null): string {
  if (!branchParam) return '';
  return `AND ${alias}.branch_id IS NOT NULL AND ${alias}.branch_id = ANY($${branchParam}::uuid[])`;
}

function cursorSql(alias: string, atParam: number | null, idParam: number | null): string {
  if (!atParam || !idParam) return '';
  return `AND (${alias}.created_at < $${atParam}::timestamptz OR (${alias}.created_at = $${atParam}::timestamptz AND ${alias}.id::text < $${idParam}))`;
}

function searchSql(expr: string, searchParam: number | null): string {
  if (!searchParam) return '';
  return `AND (${expr}) ILIKE $${searchParam} ESCAPE '\\'`;
}

export function parseRecentTxFilter(value: string | null): RecentTxFilter {
  if (value && (RECENT_TX_FILTERS as readonly string[]).includes(value)) return value as RecentTxFilter;
  return 'all';
}

export function recentTransactionLikePattern(raw: string): string | null {
  const term = raw.trim();
  if (!term) return null;
  const escaped = term.replace(/[\\%_]/g, (ch) => `\\${ch}`);
  return `%${escaped}%`;
}

/**
 * Newest invoices, purchases, standalone payments, returns, and expenses for one business.
 * A payment settled against an invoice or purchase stays on that document (paid / unpaid)
 * and is not listed again. Every branch aliases the same columns so a single-type filter
 * can still sort by sort_at. Search and the cursor are applied inside each branch.
 */
export function recentTransactionsSql(input: {
  branchParam: number | null;
  searchParam: number | null;
  cursorAtParam: number | null;
  cursorIdParam: number | null;
  limitParam: number;
  filter: RecentTxFilter;
}): string {
  const include = new Set(KIND_FOR_FILTER[input.filter]);
  const parts: string[] = [];

  if (include.has('invoice')) {
    parts.push(`
      SELECT i.id::text AS id, 'invoice' AS kind, i.invoice_number AS doc_number,
             COALESCE(c.name, 'Cash sale') AS party, i.invoice_date AS doc_date,
             i.created_at AS sort_at, i.grand_total::float8 AS amount,
             CASE WHEN i.status = 'final'
               THEN COALESCE(NULLIF(btrim(i.payment_status), ''), 'unpaid')
               ELSE i.status
             END AS status
        FROM invoices i
        LEFT JOIN customers c ON c.id = i.customer_id AND c.deleted_at IS NULL
       WHERE i.business_id = $1 AND i.deleted_at IS NULL
         ${branchSql('i', input.branchParam)}
         ${cursorSql('i', input.cursorAtParam, input.cursorIdParam)}
         ${searchSql(`COALESCE(i.invoice_number, '') || ' ' || COALESCE(c.name, '')`, input.searchParam)}
    `);
  }

  if (include.has('purchase')) {
    parts.push(`
      SELECT p.id::text AS id, 'purchase' AS kind,
             COALESCE(NULLIF(btrim(p.bill_number), ''), 'Purchase') AS doc_number,
             COALESCE(s.name, 'Supplier') AS party, p.bill_date AS doc_date,
             p.created_at AS sort_at, p.grand_total::float8 AS amount,
             CASE WHEN p.status = 'final'
               THEN COALESCE(NULLIF(btrim(p.payment_status), ''), 'unpaid')
               ELSE p.status
             END AS status
        FROM purchases p
        LEFT JOIN suppliers s ON s.id = p.supplier_id
       WHERE p.business_id = $1 AND p.deleted_at IS NULL AND p.status <> 'cancelled'
         ${branchSql('p', input.branchParam)}
         ${cursorSql('p', input.cursorAtParam, input.cursorIdParam)}
         ${searchSql(`COALESCE(p.bill_number, '') || ' ' || COALESCE(s.name, '')`, input.searchParam)}
    `);
  }

  if (include.has('payment')) {
    parts.push(`
      SELECT pay.id::text AS id,
             CASE WHEN pay.type = 'receivable' THEN 'payment_in' ELSE 'payment_out' END AS kind,
             INITCAP(REPLACE(COALESCE(pay.payment_mode, 'payment'), '_', ' ')) AS doc_number,
             COALESCE(c.name, s.name, 'Payment') AS party,
             pay.payment_date AS doc_date, pay.created_at AS sort_at,
             pay.amount::float8 AS amount, pay.status AS status
        FROM payments pay
        LEFT JOIN customers c ON c.id = pay.customer_id AND c.deleted_at IS NULL
        LEFT JOIN suppliers s ON s.id = pay.supplier_id
       WHERE pay.business_id = $1 AND pay.deleted_at IS NULL AND pay.status = 'active'
         AND COALESCE(pay.reference_type, '') NOT IN ('invoice', 'purchase')
         ${branchSql('pay', input.branchParam)}
         ${cursorSql('pay', input.cursorAtParam, input.cursorIdParam)}
         ${searchSql(`COALESCE(c.name, '') || ' ' || COALESCE(s.name, '') || ' ' || COALESCE(pay.payment_mode, '')`, input.searchParam)}
    `);
  }

  if (include.has('return')) {
    parts.push(`
      SELECT cn.id::text AS id, 'credit_note' AS kind, cn.credit_note_number AS doc_number,
             COALESCE(c.name, 'Customer') AS party, cn.credit_note_date AS doc_date,
             cn.created_at AS sort_at, cn.grand_total::float8 AS amount, cn.status AS status
        FROM credit_notes cn
        LEFT JOIN customers c ON c.id = cn.customer_id
       WHERE cn.business_id = $1 AND cn.status <> 'cancelled'
         ${branchSql('cn', input.branchParam)}
         ${cursorSql('cn', input.cursorAtParam, input.cursorIdParam)}
         ${searchSql(`COALESCE(cn.credit_note_number, '') || ' ' || COALESCE(c.name, '')`, input.searchParam)}
    `);
    parts.push(`
      SELECT pr.id::text AS id, 'purchase_return' AS kind, pr.return_number AS doc_number,
             COALESCE(s.name, 'Supplier') AS party, pr.return_date AS doc_date,
             pr.created_at AS sort_at, pr.grand_total::float8 AS amount,
             COALESCE(pr.status, 'final') AS status
        FROM purchase_returns pr
        LEFT JOIN suppliers s ON s.id = pr.supplier_id
       WHERE pr.business_id = $1 AND COALESCE(pr.status, 'final') <> 'cancelled'
         ${branchSql('pr', input.branchParam)}
         ${cursorSql('pr', input.cursorAtParam, input.cursorIdParam)}
         ${searchSql(`COALESCE(pr.return_number, '') || ' ' || COALESCE(s.name, '')`, input.searchParam)}
    `);
  }

  if (include.has('expense')) {
    parts.push(`
      SELECT e.id::text AS id, 'expense' AS kind,
             COALESCE(NULLIF(btrim(e.reference_number), ''), NULLIF(btrim(e.description), ''), 'Expense') AS doc_number,
             COALESCE(ec.name, 'Expense') AS party,
             e.expense_date AS doc_date, e.created_at AS sort_at, e.amount::float8 AS amount,
             COALESCE(NULLIF(btrim(e.payment_mode), ''), 'recorded') AS status
        FROM expenses e
        LEFT JOIN expense_categories ec ON ec.id = e.category_id
       WHERE e.business_id = $1 AND e.deleted_at IS NULL
         ${branchSql('e', input.branchParam)}
         ${cursorSql('e', input.cursorAtParam, input.cursorIdParam)}
         ${searchSql(`COALESCE(e.reference_number, '') || ' ' || COALESCE(e.description, '') || ' ' || COALESCE(ec.name, '')`, input.searchParam)}
    `);
  }

  return `
    SELECT * FROM (
      ${parts.join('\nUNION ALL\n')}
    ) recent
    ORDER BY sort_at DESC, id DESC
    LIMIT $${input.limitParam}
  `;
}
