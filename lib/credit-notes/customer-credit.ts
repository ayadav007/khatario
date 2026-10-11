import type { PoolClient } from 'pg';
import { round2 } from '@/lib/invoices/line-gst';

/**
 * Credit left on a customer after a credit note has cleared the bill it belongs to.
 * Only the part the customer had already paid (or an on-account note) can be used
 * on a later invoice. The part that merely cancels an unpaid bill is not spendable.
 */
export function unusedCreditAmount(input: {
  grandTotal: number;
  /** How much of this note was needed to clear its own invoice. */
  settledOnSourceInvoice: number;
  appliedToLaterInvoices: number;
  refundedAmount: number;
}): number {
  const grand = round2(Math.max(0, input.grandTotal));
  const settled = round2(Math.min(grand, Math.max(0, input.settledOnSourceInvoice)));
  const applied = round2(Math.max(0, input.appliedToLaterInvoices));
  const refunded = round2(Math.max(0, input.refundedAmount));
  return round2(Math.max(0, grand - settled - applied - refunded));
}

export function allocateCreditFifo(
  notes: Array<{ id: string; available: number }>,
  amount: number
): Array<{ id: string; amount: number }> {
  let left = round2(Math.max(0, amount));
  const rows: Array<{ id: string; amount: number }> = [];
  for (const note of notes) {
    if (left <= 0.004) break;
    const available = round2(Math.max(0, note.available));
    if (available <= 0.004) continue;
    const take = round2(Math.min(available, left));
    if (take <= 0.004) continue;
    rows.push({ id: note.id, amount: take });
    left = round2(left - take);
  }
  return rows;
}

export class CustomerCreditError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'CustomerCreditError';
    this.status = status;
    this.code = code;
  }
}

export type AvailableCreditNote = {
  id: string;
  credit_note_number: string;
  credit_note_date: string;
  available: number;
};

function availableSql(hasApplications: boolean): string {
  const appliedLater = hasApplications
    ? `COALESCE((
      SELECT SUM(a.amount) FROM credit_note_applications a
       WHERE a.credit_note_id = cn.id AND a.business_id = cn.business_id AND a.reversed_at IS NULL
    ), 0)`
    : '0';
  return `
  SELECT
    cn.id,
    cn.credit_note_number,
    cn.credit_note_date::text AS credit_note_date,
    cn.grand_total,
    cn.refund_status,
    cn.refund_amount,
    CASE
      WHEN cn.invoice_id IS NULL OR i.id IS NULL THEN 0
      ELSE LEAST(
        cn.grand_total,
        GREATEST(
          0,
          COALESCE(i.grand_total, 0)
          + COALESCE((
              SELECT SUM(d.grand_total) FROM debit_notes d
               WHERE d.invoice_id = i.id AND d.business_id = cn.business_id AND d.status = 'active'
            ), 0)
          - COALESCE(i.paid_amount, 0)
          - COALESCE(i.tds_received, 0)
          - COALESCE(i.advance_adjusted, 0)
          - COALESCE((
              SELECT SUM(earlier.grand_total) FROM credit_notes earlier
               WHERE earlier.invoice_id = cn.invoice_id
                 AND earlier.business_id = cn.business_id
                 AND earlier.status = 'active'
                 AND earlier.id <> cn.id
                 AND (earlier.created_at, earlier.id) < (cn.created_at, cn.id)
            ), 0)
        )
      )
    END AS settled_on_source,
    ${appliedLater} AS applied_later
  FROM credit_notes cn
  LEFT JOIN invoices i ON i.id = cn.invoice_id AND i.business_id = cn.business_id AND i.deleted_at IS NULL
  WHERE cn.business_id = $1
    AND cn.customer_id = $2
    AND cn.status = 'active'
    AND cn.refund_status <> 'refunded'
`;
}

async function hasApplicationsTable(client: PoolClient): Promise<boolean> {
  const found = await client.query<{ t: string | null }>(
    `SELECT to_regclass('public.credit_note_applications') AS t`
  );
  return !!found.rows[0]?.t;
}

type AvailableRow = {
  id: string;
  credit_note_number: string;
  credit_note_date: string;
  grand_total: string;
  refund_status: string;
  refund_amount: string | null;
  settled_on_source: string;
  applied_later: string;
};

function rowAvailable(row: AvailableRow): number {
  return unusedCreditAmount({
    grandTotal: Number(row.grand_total) || 0,
    settledOnSourceInvoice: Number(row.settled_on_source) || 0,
    appliedToLaterInvoices: Number(row.applied_later) || 0,
    refundedAmount: row.refund_status === 'refunded' ? Number(row.grand_total) || 0 : Number(row.refund_amount) || 0,
  });
}

export async function listAvailableCustomerCredits(
  client: PoolClient,
  businessId: string,
  customerId: string
): Promise<{ available: number; current_balance: number; notes: AvailableCreditNote[] }> {
  const customer = await client.query<{ current_balance: string }>(
    `SELECT current_balance FROM customers WHERE id = $1 AND business_id = $2 AND deleted_at IS NULL`,
    [customerId, businessId]
  );
  if (!customer.rows[0]) {
    throw new CustomerCreditError(404, 'CUSTOMER_NOT_FOUND', 'Customer not found');
  }
  const rows = await client.query<AvailableRow>(
    `${availableSql(await hasApplicationsTable(client))} ORDER BY cn.credit_note_date, cn.created_at, cn.id`,
    [businessId, customerId]
  );
  const notes = rows.rows
    .map((row) => ({
      id: row.id,
      credit_note_number: row.credit_note_number,
      credit_note_date: String(row.credit_note_date).slice(0, 10),
      available: rowAvailable(row),
    }))
    .filter((note) => note.available > 0.004);
  const available = round2(notes.reduce((sum, note) => sum + note.available, 0));
  return {
    available,
    current_balance: Number(customer.rows[0].current_balance) || 0,
    notes,
  };
}

/** A note that no longer has spendable credit is adjusted against a bill, not waiting for a refund. */
export async function refreshCreditNoteRefundStatus(
  client: PoolClient,
  businessId: string,
  creditNoteId: string
): Promise<void> {
  const row = await client.query<{ customer_id: string; refund_status: string }>(
    `SELECT customer_id, refund_status FROM credit_notes WHERE id = $1 AND business_id = $2`,
    [creditNoteId, businessId]
  );
  const note = row.rows[0];
  if (!note || note.refund_status === 'refunded' || note.refund_status === 'cancelled') return;
  const listed = await client.query<AvailableRow>(
    `${availableSql(await hasApplicationsTable(client))} AND cn.id = $3`,
    [businessId, note.customer_id, creditNoteId]
  );
  const found = listed.rows[0];
  if (!found) return;
  const available = rowAvailable(found);
  if (available <= 0.004) {
    await client.query(
      `UPDATE credit_notes
          SET refund_status = 'adjusted',
              refund_mode = COALESCE(NULLIF(refund_mode, ''), 'adjusted_to_invoice'),
              updated_at = CURRENT_TIMESTAMP
        WHERE id = $1 AND business_id = $2 AND refund_status <> 'refunded'`,
      [creditNoteId, businessId]
    );
    return;
  }
  if (note.refund_status === 'adjusted') {
    await client.query(
      `UPDATE credit_notes
          SET refund_status = 'pending',
              updated_at = CURRENT_TIMESTAMP
        WHERE id = $1 AND business_id = $2 AND refund_status = 'adjusted'`,
      [creditNoteId, businessId]
    );
  }
}

/**
 * Uses the customer's unused credit notes on a new final invoice.
 * The credit note already reduced what the customer owes, so this only allocates
 * that credit onto the new bill. It does not move the customer balance again.
 */
export async function applyCustomerCredit(
  client: PoolClient,
  input: {
    businessId: string;
    customerId: string;
    invoiceId: string;
    amount: number;
    userId: string;
  }
): Promise<{ amount: number }> {
  const amount = round2(input.amount);
  if (!(amount > 0.004)) return { amount: 0 };
  if (!(await hasApplicationsTable(client))) {
    throw new CustomerCreditError(
      503,
      'MIGRATION_REQUIRED',
      'Customer credit is not available until the database migration is applied'
    );
  }

  const invoice = await client.query<{
    customer_id: string | null;
    status: string;
    document_type: string | null;
    grand_total: string;
    paid_amount: string;
  }>(
    `SELECT customer_id, status, document_type, grand_total, paid_amount
       FROM invoices
      WHERE id = $1 AND business_id = $2 AND deleted_at IS NULL
      FOR UPDATE`,
    [input.invoiceId, input.businessId]
  );
  const inv = invoice.rows[0];
  if (!inv) throw new CustomerCreditError(404, 'INVOICE_NOT_FOUND', 'Invoice not found');
  if (inv.customer_id !== input.customerId) {
    throw new CustomerCreditError(400, 'PARTY_MISMATCH', 'This credit belongs to a different customer');
  }
  if (inv.status !== 'final' || inv.document_type === 'proforma_invoice') {
    throw new CustomerCreditError(400, 'INVOICE_NOT_FINAL', 'Customer credit can only be used on a final tax invoice');
  }
  const room = round2((Number(inv.grand_total) || 0) - (Number(inv.paid_amount) || 0));
  if (amount > room + 0.005) {
    throw new CustomerCreditError(
      400,
      'EXCEEDS_INVOICE',
      `Only ₹${Math.max(0, room).toFixed(2)} of this invoice can be settled with customer credit`
    );
  }

  await client.query(
    `SELECT id FROM credit_notes
      WHERE business_id = $1 AND customer_id = $2 AND status = 'active'
      FOR UPDATE`,
    [input.businessId, input.customerId]
  );
  const open = await listAvailableCustomerCredits(client, input.businessId, input.customerId);
  if (amount > open.available + 0.005) {
    throw new CustomerCreditError(
      400,
      'EXCEEDS_CREDIT',
      open.available > 0.004
        ? `Only ₹${open.available.toFixed(2)} of customer credit is available`
        : 'This customer has no credit from a paid credit note to use'
    );
  }
  const slices = allocateCreditFifo(open.notes, amount);
  const applied = round2(slices.reduce((sum, slice) => sum + slice.amount, 0));
  if (applied + 0.005 < amount) {
    throw new CustomerCreditError(400, 'EXCEEDS_CREDIT', 'This customer has no credit from a paid credit note to use');
  }
  for (const slice of slices) {
    await client.query(
      `INSERT INTO credit_note_applications (business_id, credit_note_id, invoice_id, amount, created_by)
       VALUES ($1, $2, $3, $4, $5)`,
      [input.businessId, slice.id, input.invoiceId, slice.amount, input.userId]
    );
    await refreshCreditNoteRefundStatus(client, input.businessId, slice.id);
  }
  return { amount: applied };
}

/** Puts credit used on a cancelled invoice back on the credit notes. Does not move the customer balance. */
export async function releaseCreditApplicationsForInvoice(
  client: PoolClient,
  input: { businessId: string; invoiceId: string; userId: string | null }
): Promise<number> {
  const exists = await client.query<{ t: string | null }>(
    `SELECT to_regclass('public.credit_note_applications') AS t`
  );
  if (!exists.rows[0]?.t) return 0;
  const released = await client.query<{ credit_note_id: string; amount: string }>(
    `UPDATE credit_note_applications
        SET reversed_at = CURRENT_TIMESTAMP, reversed_by = $3
      WHERE business_id = $1 AND invoice_id = $2 AND reversed_at IS NULL
      RETURNING credit_note_id, amount`,
    [input.businessId, input.invoiceId, input.userId]
  );
  const ids = [...new Set(released.rows.map((row) => row.credit_note_id))];
  for (const id of ids) {
    await refreshCreditNoteRefundStatus(client, input.businessId, id);
  }
  return round2(released.rows.reduce((sum, row) => sum + (Number(row.amount) || 0), 0));
}

export async function creditNoteHasLiveApplications(
  client: PoolClient,
  businessId: string,
  creditNoteId: string
): Promise<boolean> {
  const exists = await client.query<{ t: string | null }>(
    `SELECT to_regclass('public.credit_note_applications') AS t`
  );
  if (!exists.rows[0]?.t) return false;
  const hit = await client.query(
    `SELECT 1 FROM credit_note_applications
      WHERE business_id = $1 AND credit_note_id = $2 AND reversed_at IS NULL
      LIMIT 1`,
    [businessId, creditNoteId]
  );
  return hit.rows.length > 0;
}
