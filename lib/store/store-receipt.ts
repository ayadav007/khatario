import type { PoolClient } from 'pg';
import { getPool } from '@/lib/db';
import { createPaymentLedgerEntries, getAccountForPaymentMode } from '@/lib/ledger-utils';
import { recomputeInvoiceBalance } from '@/lib/invoices/invoice-balance';
import { assertPeriodNotLocked } from '@/lib/period-lock-utils';

export const STORE_RECEIPT_ACTOR = 'razorpay_webhook' as const;

export function storeReceiptActor(provider: string | null | undefined): string {
  return provider === 'easebuzz' ? 'easebuzz_webhook' : STORE_RECEIPT_ACTOR;
}

/** Easebuzz `mode`: UPI, CC, DC, NB, MW (wallet), EMI, … */
function easebuzzPaymentMode(mode: string): string {
  switch (mode.toUpperCase()) {
    case 'CC':
    case 'DC':
    case 'EMI':
    case 'PL':
      return 'credit_card';
    case 'NB':
      return 'bank';
    case 'UPI':
      return 'upi';
    case 'MW':
    case 'OM':
      return 'wallet';
    default:
      return 'cash';
  }
}

/** Raised when a verified payment is saved but the invoice or receipt is not posted yet. */
export class StoreReceiptPendingError extends Error {
  readonly code = 'STORE_RECEIPT_PENDING';
  constructor(message: string) {
    super(message);
    this.name = 'StoreReceiptPendingError';
  }
}

/**
 * Maps a Razorpay `payment.entity.method` onto the payment modes the receipt
 * service already understands. Card uses `credit_card` and netbanking uses
 * `bank`, which are the configured mapping keys. An absent method uses `cash`,
 * the same default as a receipt recorded without a mode.
 */
export function storeReceiptPaymentMode(payload: unknown): string {
  let body: unknown = payload;
  if (typeof payload === 'string') {
    try {
      body = JSON.parse(payload);
    } catch {
      body = null;
    }
  }
  const entity = (body as { payload?: { payment?: { entity?: { method?: unknown } } } } | null)?.payload
    ?.payment?.entity;
  const ebMode = (body as { easepayid?: unknown; mode?: unknown } | null);
  if (!entity && typeof ebMode?.easepayid === 'string' && typeof ebMode.mode === 'string') {
    return easebuzzPaymentMode(ebMode.mode);
  }
  const method = typeof entity?.method === 'string' ? entity.method.toLowerCase() : '';
  if (method === 'card' || method === 'emi' || method === 'cardless_emi' || method === 'paylater') {
    return 'credit_card';
  }
  if (method === 'netbanking') return 'bank';
  if (method === 'upi') return 'upi';
  if (method === 'wallet') return 'wallet';
  return method || 'cash';
}

export type StoreReceiptResult =
  | { outcome: 'posted'; paymentId: string }
  | { outcome: 'already_posted'; paymentId: string }
  | { outcome: 'skipped'; reason: string };

/**
 * Posts one receipt for a verified paid store order, against its final customer invoice.
 * The order row is locked. A second call does not insert another payment or voucher.
 * Webhook identity is `razorpay_webhook`; created_by stays null.
 */
export async function settleStoreOrderReceipt(
  orderId: string,
  businessId: string,
): Promise<StoreReceiptResult> {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const order = await client.query<{
      payment_status: string;
      invoice_id: string | null;
      provider_payment_id: string | null;
      receipt_payment_id: string | null;
      grand_total: string;
      order_number: string;
      payment_provider: string | null;
    }>(
      `SELECT payment_status, invoice_id, provider_payment_id, receipt_payment_id,
              grand_total::text, order_number, payment_provider
         FROM store_orders
        WHERE id = $1 AND business_id = $2
        FOR UPDATE`,
      [orderId, businessId],
    );
    const row = order.rows[0];
    if (!row) {
      await client.query('ROLLBACK');
      return { outcome: 'skipped', reason: 'ORDER_NOT_FOUND' };
    }
    if (row.receipt_payment_id) {
      await client.query('COMMIT');
      return { outcome: 'already_posted', paymentId: row.receipt_payment_id };
    }
    if (row.payment_status !== 'paid') {
      await client.query('ROLLBACK');
      return { outcome: 'skipped', reason: 'NOT_PAID' };
    }
    if (!row.invoice_id) {
      await client.query('ROLLBACK');
      return { outcome: 'skipped', reason: 'NO_INVOICE' };
    }

    const inv = await client.query<{
      id: string;
      status: string;
      document_type: string | null;
      customer_id: string | null;
      branch_id: string | null;
      invoice_number: string;
      grand_total: string;
      business_id: string;
    }>(
      `SELECT id, status, document_type, customer_id, branch_id, invoice_number,
              grand_total::text, business_id
         FROM invoices
        WHERE id = $1 AND business_id = $2 AND deleted_at IS NULL
        FOR UPDATE`,
      [row.invoice_id, businessId],
    );
    const invoice = inv.rows[0];
    if (!invoice || invoice.status !== 'final' || invoice.document_type === 'proforma_invoice') {
      await client.query('ROLLBACK');
      return { outcome: 'skipped', reason: 'INVOICE_NOT_FINAL' };
    }
    const expected = parseFloat(row.grand_total) || 0;
    const invoiced = parseFloat(invoice.grand_total) || 0;
    if (Math.round(expected * 100) !== Math.round(invoiced * 100)) {
      await client.query('ROLLBACK');
      return { outcome: 'skipped', reason: 'AMOUNT_MISMATCH' };
    }

    const event = await client.query<{ payload: unknown }>(
      `SELECT payload FROM store_payment_events
        WHERE order_id = $1 AND business_id = $2 AND status = 'processed'
        ORDER BY processed_at DESC NULLS LAST, created_at DESC
        LIMIT 1`,
      [orderId, businessId],
    );
    const paymentMode = storeReceiptPaymentMode(event.rows[0]?.payload ?? null);
    const providerName = row.payment_provider === 'easebuzz' ? 'Easebuzz' : 'Razorpay';
    const paymentId = await postStoreInvoiceReceipt(client, {
      businessId,
      invoice,
      amount: expected,
      paymentMode,
      createdBy: null,
      notes: `${providerName} store receipt ${row.order_number}`,
      description: `${providerName} receipt for invoice ${invoice.invoice_number}`,
    });
    const linked = await client.query(
      `UPDATE store_orders
          SET receipt_payment_id = $3,
              receipt_actor_type = $4,
              updated_at = CURRENT_TIMESTAMP
        WHERE id = $1 AND business_id = $2 AND receipt_payment_id IS NULL
        RETURNING id`,
      [orderId, businessId, paymentId, storeReceiptActor(row.payment_provider)],
    );
    if (linked.rows.length === 0) {
      throw new Error('Store receipt was already posted');
    }
    await client.query('COMMIT');
    return { outcome: 'posted', paymentId };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

type StoreReceiptInvoice = {
  id: string;
  customer_id: string | null;
  branch_id: string | null;
  invoice_number: string;
};

/**
 * One receipt row against a store invoice, on the caller's transaction.
 * A customer invoice debits the payment-mode account and credits Accounts Receivable.
 * A cash-sale invoice (older store orders, no customer) already debited Cash when it was
 * posted, so only the payment row and paid amount are recorded, as POS cash sales do.
 */
async function postStoreInvoiceReceipt(
  client: PoolClient,
  p: {
    businessId: string;
    invoice: StoreReceiptInvoice;
    amount: number;
    paymentMode: string;
    createdBy: string | null;
    notes: string;
    description: string;
  },
): Promise<string> {
  const { businessId, invoice, amount, paymentMode } = p;
  const paymentDate = new Date();
  await assertPeriodNotLocked(businessId, invoice.branch_id, paymentDate, 'record a store receipt');
  if (invoice.customer_id) {
    const paymentAccount = await getAccountForPaymentMode(businessId, paymentMode);
    if (!paymentAccount) {
      throw new Error('No ledger account is mapped for the store receipt');
    }
  }

  const payment = await client.query<{ id: string }>(
    `INSERT INTO payments (
       business_id, branch_id, type, customer_id, reference_type, reference_id,
       amount, payment_mode, payment_date, notes, created_by
     ) VALUES ($1,$2,'receivable',$3,'invoice',$4,$5,$6,$7,$8,$9)
     RETURNING id`,
    [businessId, invoice.branch_id, invoice.customer_id, invoice.id, amount, paymentMode, paymentDate, p.notes, p.createdBy],
  );
  const paymentId = payment.rows[0].id;
  if (invoice.customer_id) {
    await createPaymentLedgerEntries({
      businessId,
      paymentId,
      paymentDate,
      amount,
      type: 'receivable',
      customerId: invoice.customer_id,
      paymentMode,
      referenceNumber: invoice.invoice_number,
      description: p.description,
      branchId: invoice.branch_id ?? undefined,
      poolClient: client,
    });
    await client.query(
      `UPDATE customers
          SET current_balance = current_balance - $1, updated_at = CURRENT_TIMESTAMP
        WHERE id = $2 AND business_id = $3`,
      [amount, invoice.customer_id, businessId],
    );
  }
  await client.query(
    `UPDATE invoices SET paid_amount = COALESCE(paid_amount, 0) + $1
      WHERE id = $2 AND business_id = $3`,
    [amount, invoice.id, businessId],
  );
  await recomputeInvoiceBalance(client, invoice.id, businessId);
  return paymentId;
}

export class StoreCashCollectError extends Error {
  constructor(
    message: string,
    public statusCode: number,
    public code: string,
  ) {
    super(message);
    this.name = 'StoreCashCollectError';
  }
}

/**
 * Marks a pay-on-delivery or direct-UPI order collected and posts the receipt against its
 * invoice in the same transaction. A second call finds `cash_collected_at` set and does nothing.
 * `actorUserId` is the session user; it is never read from the request body.
 */
export async function collectStoreOrderCash(
  orderId: string,
  businessId: string,
  actorUserId: string | null,
): Promise<{ paymentId: string | null }> {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const order = await client.query<{
      payment_status: string;
      payment_provider: string | null;
      invoice_id: string | null;
      cash_collected_at: Date | null;
      grand_total: string;
      order_number: string;
    }>(
      `SELECT payment_status, payment_provider, invoice_id, cash_collected_at, grand_total::text, order_number
         FROM store_orders
        WHERE id = $1 AND business_id = $2
        FOR UPDATE`,
      [orderId, businessId],
    );
    const row = order.rows[0];
    if (!row || row.payment_status !== 'cod') {
      throw new StoreCashCollectError('COD order not found', 404, 'ORDER_NOT_FOUND');
    }
    if (row.cash_collected_at) {
      await client.query('COMMIT');
      return { paymentId: null };
    }
    if (!row.invoice_id) {
      throw new StoreCashCollectError(
        'This order has no invoice yet. Confirm the order so the sale is posted, then mark the cash collected.',
        409,
        'NO_INVOICE',
      );
    }
    const inv = await client.query<StoreReceiptInvoice & { status: string; balance_amount: string }>(
      `SELECT id, customer_id, branch_id, invoice_number, status, balance_amount::text
         FROM invoices
        WHERE id = $1 AND business_id = $2 AND deleted_at IS NULL
        FOR UPDATE`,
      [row.invoice_id, businessId],
    );
    const invoice = inv.rows[0];
    if (!invoice || invoice.status !== 'final') {
      throw new StoreCashCollectError('The invoice for this order is not final', 409, 'INVOICE_NOT_FINAL');
    }

    let paymentId: string | null = null;
    const due = Math.min(parseFloat(invoice.balance_amount) || 0, parseFloat(row.grand_total) || 0);
    if (due > 0.005) {
      const isUpi = row.payment_provider === 'upi';
      paymentId = await postStoreInvoiceReceipt(client, {
        businessId,
        invoice,
        amount: due,
        paymentMode: isUpi ? 'upi' : 'cash',
        createdBy: actorUserId,
        notes: `${isUpi ? 'UPI' : 'Cash on delivery'} store receipt ${row.order_number}`,
        description: `${isUpi ? 'UPI' : 'Cash'} received for invoice ${invoice.invoice_number}`,
      });
    }
    await client.query(
      `UPDATE store_orders
          SET cash_collected_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
        WHERE id = $1 AND business_id = $2`,
      [orderId, businessId],
    );
    await client.query('COMMIT');
    return { paymentId };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}
