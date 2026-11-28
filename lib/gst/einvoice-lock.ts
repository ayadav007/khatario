// An invoice with an active e-invoice (IRN) is a filed document: its lines, totals, customer, number and date
// must not change, and it is not cancelled here until the IRN is. Payment, e-way number and IRN fields stay open.
import type { PoolClient } from 'pg';

type Queryable = Pick<PoolClient, 'query'>;

export const IRN_LOCK_MESSAGE = 'This invoice has an e-invoice (IRN), so it cannot be changed. Cancel the e-invoice within 24 hours, or issue a credit note.';

/** Resolves a 409 response body when the invoice has an active IRN, else null. */
export async function irnLock(db: Queryable, businessId: string, invoiceId: string): Promise<{ error: string; code: 'IRN_LOCKED' } | null> {
  const r = await db.query(
    `SELECT 1 FROM invoices WHERE id = $1 AND business_id = $2 AND irn_status = 'active' LIMIT 1`,
    [invoiceId, businessId],
  );
  return r.rows.length ? { error: IRN_LOCK_MESSAGE, code: 'IRN_LOCKED' } : null;
}
