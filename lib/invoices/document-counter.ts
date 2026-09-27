/**
 * Per-branch, per-document-type number series (tax invoice, estimate, bill of supply).
 * Backed by branch_document_counters (migration 301). A missing row is seeded lazily
 * from the highest number already used in that series, so new branches just work.
 */

export type CounterSeries = 'tax_invoice' | 'proforma_invoice' | 'bill_of_supply';

export const COUNTER_SERIES: CounterSeries[] = ['tax_invoice', 'proforma_invoice', 'bill_of_supply'];

interface Queryable {
  query: (text: string, params?: unknown[]) => Promise<{ rows: any[] }>;
}

export function counterSeriesFor(documentType?: string | null): CounterSeries {
  if (documentType === 'proforma_invoice' || documentType === 'bill_of_supply') return documentType;
  return 'tax_invoice';
}

function seriesDocumentTypes(series: CounterSeries): string[] {
  return series === 'tax_invoice' ? ['tax_invoice', 'regular'] : [series];
}

async function seedCounter(db: Queryable, branchId: string, series: CounterSeries): Promise<void> {
  await db.query(
    `INSERT INTO branch_document_counters (branch_id, document_type, next_number)
     SELECT b.id, $2::varchar,
            GREATEST(
              CASE WHEN $2::varchar = 'tax_invoice' THEN COALESCE(b.next_invoice_number, 1) ELSE 1 END,
              COALESCE((
                SELECT MAX(SUBSTRING(i.invoice_number FROM '(\\d+)$')::bigint)
                FROM invoices i
                WHERE i.branch_id = b.id
                  AND i.invoice_number ~ '\\d+$'
                  AND COALESCE(i.document_type, 'tax_invoice') = ANY($3::text[])
              ), 0) + 1
            )::integer
     FROM branches b
     WHERE b.id = $1
     ON CONFLICT (branch_id, document_type) DO NOTHING`,
    [branchId, series, seriesDocumentTypes(series)]
  );
}

/** Next number that would be issued, without consuming it. */
export async function peekNextDocumentNumber(
  db: Queryable,
  branchId: string,
  documentType?: string | null
): Promise<number> {
  const series = counterSeriesFor(documentType);
  await seedCounter(db, branchId, series);
  const res = await db.query(
    `SELECT next_number FROM branch_document_counters WHERE branch_id = $1 AND document_type = $2`,
    [branchId, series]
  );
  return Number(res.rows[0]?.next_number) || 1;
}

/**
 * Consume a number from the series. Must run inside a transaction.
 * `requested` (the number shown/edited in the form) is honoured only when it is ahead of
 * the counter; a lower value may come from a stale cached preview and could reuse a number.
 */
export async function reserveDocumentNumber(
  client: Queryable,
  branchId: string,
  documentType?: string | null,
  requested?: number | null
): Promise<number> {
  const series = counterSeriesFor(documentType);
  await seedCounter(client, branchId, series);
  const res = await client.query(
    `SELECT next_number FROM branch_document_counters
     WHERE branch_id = $1 AND document_type = $2 FOR UPDATE`,
    [branchId, series]
  );
  const current = Number(res.rows[0]?.next_number) || 1;
  const issued = requested && requested > current ? requested : current;
  await client.query(
    `UPDATE branch_document_counters
     SET next_number = GREATEST(next_number, $3::integer + 1), updated_at = NOW()
     WHERE branch_id = $1 AND document_type = $2`,
    [branchId, series, issued]
  );
  if (series === 'tax_invoice') {
    // Legacy readers (branch settings screens) still show branches.next_invoice_number
    await client.query(
      `UPDATE branches SET next_invoice_number = GREATEST(COALESCE(next_invoice_number, 1), $2::integer + 1),
              updated_at = CURRENT_TIMESTAMP
       WHERE id = $1`,
      [branchId, issued]
    );
  }
  return issued;
}

const DEFAULT_PREFIX: Record<CounterSeries, string> = {
  tax_invoice: 'INV',
  proforma_invoice: 'PI',
  bill_of_supply: 'BOS',
};

/** Branch-specific prefix for the document type (branch_document_prefixes), else the default. */
export async function resolveDocumentPrefix(
  db: Queryable,
  branchId: string,
  documentType?: string | null
): Promise<string> {
  const series = counterSeriesFor(documentType);
  try {
    const res = await db.query(
      `SELECT prefix FROM branch_document_prefixes WHERE branch_id = $1 AND document_type = $2`,
      [branchId, series]
    );
    if (res.rows[0]?.prefix) return String(res.rows[0].prefix);
  } catch (error: unknown) {
    if ((error as { code?: string }).code !== '42P01') throw error;
  }
  return DEFAULT_PREFIX[series];
}

/** Reserve the next number and format it, e.g. "INV-004". Must run inside a transaction. */
export async function reserveFormattedDocumentNumber(
  client: Queryable,
  branchId: string,
  documentType?: string | null
): Promise<string> {
  const prefix = await resolveDocumentPrefix(client, branchId, documentType);
  const n = await reserveDocumentNumber(client, branchId, documentType);
  return `${prefix}-${String(n).padStart(3, '0')}`;
}

/**
 * Admin override from number-series settings. Never goes below the highest number
 * already used in the series, so a stale settings form cannot cause duplicates.
 * Returns the value actually stored.
 */
export async function setNextDocumentNumber(
  db: Queryable,
  branchId: string,
  documentType: string,
  nextNumber: number
): Promise<number> {
  const series = counterSeriesFor(documentType);
  const usedRes = await db.query(
    `SELECT COALESCE(MAX(SUBSTRING(invoice_number FROM '(\\d+)$')::bigint), 0) AS max_used
     FROM invoices
     WHERE branch_id = $1
       AND invoice_number ~ '\\d+$'
       AND COALESCE(document_type, 'tax_invoice') = ANY($2::text[])`,
    [branchId, seriesDocumentTypes(series)]
  );
  const floor = Number(usedRes.rows[0]?.max_used || 0) + 1;
  const value = Math.max(floor, Math.floor(nextNumber) || 1);
  await db.query(
    `INSERT INTO branch_document_counters (branch_id, document_type, next_number)
     VALUES ($1, $2, $3)
     ON CONFLICT (branch_id, document_type) DO UPDATE SET next_number = EXCLUDED.next_number, updated_at = NOW()`,
    [branchId, series, value]
  );
  if (series === 'tax_invoice') {
    await db.query(`UPDATE branches SET next_invoice_number = $2 WHERE id = $1`, [branchId, value]);
  }
  return value;
}
