/**
 * Khatario's own subscription payment records (billing_transactions) are revenue records and must
 * outlive the tenant that paid. Before a business is hard-deleted its rows are copied here
 * (billing_transactions_archive, migration 479: same columns, no foreign keys).
 */

import type { PoolClient } from 'pg';
import { queryRows } from '@/lib/db';

/** Columns copied from billing_transactions, in table order. Used by both halves of the INSERT ... SELECT. */
export const BILLING_TRANSACTION_COLUMNS = [
  'id',
  'business_id',
  'subscription_id',
  'type',
  'status',
  'amount',
  'currency',
  'plan_id',
  'billing_cycle',
  'payment_method',
  'payment_reference',
  'gateway_order_id',
  'gateway_response',
  'coupon_id',
  'discount_amount',
  'tax_amount',
  'total_amount',
  'description',
  'invoice_number',
  'invoice_url',
  'period_start',
  'period_end',
  'metadata',
  'created_at',
  'updated_at',
  'module_key',
  'taxable_amount',
  'cgst_amount',
  'sgst_amount',
  'igst_amount',
  'gst_rate',
  'gst_mode',
] as const;

export const BILLING_ARCHIVE_TABLE = 'billing_transactions_archive';

export const ARCHIVE_MISSING_MESSAGE =
  'Run migration 479 before deleting a business: payment records must be archived first.';

/** Throws (and so refuses the delete) when the archive table is absent. `table` is overridable for tests. */
export async function assertBillingArchiveExists(
  client: Pick<PoolClient, 'query'>,
  table: string = BILLING_ARCHIVE_TABLE,
): Promise<void> {
  const r = await client.query(`SELECT to_regclass($1) AS t`, [`public.${table}`]);
  if (!r.rows[0]?.t) throw new Error(ARCHIVE_MISSING_MESSAGE);
}

/**
 * Copies every billing_transactions row of the business into billing_transactions_archive.
 * Idempotent per row (ON CONFLICT (id) DO NOTHING). Returns the number of rows archived.
 * Runs on the caller's client, so it joins the caller's transaction.
 */
export async function archiveBusinessBillingTransactions(
  client: Pick<PoolClient, 'query'>,
  businessId: string,
  reason: string,
  opts: { archiveTable?: string } = {},
): Promise<number> {
  const table = opts.archiveTable ?? BILLING_ARCHIVE_TABLE;
  if (!/^[a-z_][a-z0-9_]*$/.test(table)) throw new Error(`Invalid archive table name: ${table}`);
  await assertBillingArchiveExists(client, table);
  const cols = BILLING_TRANSACTION_COLUMNS.join(', ');
  const selectCols = BILLING_TRANSACTION_COLUMNS.map((c) => `bt.${c}`).join(', ');
  let r;
  try {
    r = await client.query(
      `INSERT INTO ${table} (${cols}, archived_at, business_name, business_gstin, archive_reason)
       SELECT ${selectCols}, CURRENT_TIMESTAMP, b.name, b.gstin, $2
         FROM billing_transactions bt
         JOIN businesses b ON b.id = bt.business_id
        WHERE bt.business_id = $1
       ON CONFLICT (id) DO NOTHING`,
      [businessId, reason],
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Payment archive failed: ${msg}`);
  }
  return r.rowCount ?? 0;
}

export interface ArchivedBillingTransaction {
  id: string;
  business_id: string;
  business_name: string | null;
  business_gstin: string | null;
  status: string;
  total_amount: string;
  plan_id: string | null;
  payment_reference: string | null;
  created_at: string | null;
  archived_at: string;
  archive_reason: string;
}

/** Newest archived first. limit is clamped to 1..200, offset to >= 0. */
export async function listArchivedBillingTransactions(
  limit = 50,
  offset = 0,
): Promise<ArchivedBillingTransaction[]> {
  const n = Math.floor(Number(limit));
  const lim = Number.isFinite(n) ? Math.min(200, Math.max(1, n)) : 50;
  const o = Math.floor(Number(offset));
  const off = Number.isFinite(o) ? Math.max(0, o) : 0;
  return queryRows<ArchivedBillingTransaction>(
    `SELECT id, business_id, business_name, business_gstin, status, total_amount::text AS total_amount,
            plan_id, payment_reference, created_at, archived_at, archive_reason
       FROM ${BILLING_ARCHIVE_TABLE}
      ORDER BY archived_at DESC, id
      LIMIT $1 OFFSET $2`,
    [lim, off],
  );
}
