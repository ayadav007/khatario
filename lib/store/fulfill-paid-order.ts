import { getPool } from '@/lib/db';
import { resolveBranchId } from '@/lib/branch-helpers';
import { createInvoiceInTransaction } from '@/lib/invoices/invoice-create-service';
import { roundMoney } from '@/lib/store/pricing';
import { storePaymentAmountMatches } from '@/lib/store/fulfillment-rules';

export type StoreOnlinePaymentProvider = 'razorpay' | 'easebuzz';

export interface StorePaymentEvent {
  provider: StoreOnlinePaymentProvider;
  idempotencyKey: string;
  amount: number | null | undefined;
  currency?: string | null;
  payload: string;
  providerPaymentId?: string | null;
  providerOrderId?: string | null;
}

export function storeProviderLabel(provider: string | null | undefined): string {
  return provider === 'easebuzz' ? 'Easebuzz' : 'Razorpay';
}

export type StorePaymentRejection = 'ORDER_NOT_FOUND' | 'ALREADY_PAID' | 'ORDER_CANCELLED' | 'AMOUNT_MISMATCH';

export type StorePaymentOutcome =
  | { outcome: 'fulfilled' }
  | { outcome: 'duplicate' }
  | { outcome: 'rejected'; reason: StorePaymentRejection };

/**
 * Marks a store order paid for one verified provider event. The event row and the order change
 * commit together: a failed fulfilment leaves the event retryable (status 'failed'), and a
 * processed or rejected event is never applied twice.
 */
export async function fulfillStoreOrderPayment(
  orderId: string,
  businessId: string,
  event: StorePaymentEvent,
): Promise<StorePaymentOutcome> {
  const pool = getPool();
  const client = await pool.connect();
  let notify: {
    couponCode: string | null;
    phone: string;
    orderNumber: string;
    grandTotal: number;
    customerName: string;
    storeName: string;
  } | null = null;
  try {
    await client.query('BEGIN');
    const claimed = await client.query<{ id: string }>(
      `INSERT INTO store_payment_events
         (business_id, order_id, provider, idempotency_key, payload, amount, status, processed_at)
       VALUES ($1, (SELECT id FROM store_orders WHERE id = $2 AND business_id = $1),
               $3, $4, $5::jsonb, $6, 'processed', CURRENT_TIMESTAMP)
       ON CONFLICT (provider, idempotency_key) DO UPDATE
         SET status = 'processed', payload = EXCLUDED.payload, amount = EXCLUDED.amount,
             error_message = NULL, processed_at = CURRENT_TIMESTAMP
         WHERE store_payment_events.status = 'failed'
       RETURNING id`,
      [businessId, orderId, event.provider, event.idempotencyKey, event.payload, event.amount ?? null],
    );
    const eventId = claimed.rows[0]?.id;
    if (!eventId) {
      await client.query('ROLLBACK');
      await reconcilePaidStoreOrder(orderId, businessId);
      return { outcome: 'duplicate' };
    }

    const reject = async (reason: StorePaymentRejection): Promise<StorePaymentOutcome> => {
      await client.query(
        `UPDATE store_payment_events SET status = 'rejected', error_message = $2 WHERE id = $1`,
        [eventId, reason],
      );
      await client.query('COMMIT');
      return { outcome: 'rejected', reason };
    };

    const order = await client.query<{
      payment_status: string;
      status: string;
      coupon_code: string | null;
      customer_phone: string;
      customer_name: string | null;
      order_number: string;
      grand_total: string;
      store_name: string | null;
    }>(
      `SELECT o.payment_status, o.status, o.coupon_code, o.customer_phone, o.customer_name, o.order_number,
              o.grand_total::text, b.name AS store_name
       FROM store_orders o
       JOIN businesses b ON b.id = o.business_id
       WHERE o.id = $1 AND o.business_id = $2
       FOR UPDATE OF o`,
      [orderId, businessId],
    );
    const row = order.rows[0];
    if (!row) return await reject('ORDER_NOT_FOUND');
    if (row.payment_status === 'paid') return await reject('ALREADY_PAID');
    if (row.status === 'cancelled') return await reject('ORDER_CANCELLED');
    const grandTotal = parseFloat(row.grand_total) || 0;
    const currency = (event.currency || 'INR').toUpperCase();
    if (currency !== 'INR' || !storePaymentAmountMatches(event.amount, grandTotal)) {
      return await reject('AMOUNT_MISMATCH');
    }

    await client.query(
      `UPDATE store_orders
       SET payment_status = 'paid',
           status = CASE WHEN status = 'pending' THEN 'confirmed' ELSE status END,
           payment_provider = $5,
           provider_payment_id = COALESCE($3, provider_payment_id),
           payment_ref = COALESCE(payment_ref, $4),
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $1 AND business_id = $2`,
      [orderId, businessId, event.providerPaymentId ?? null, event.providerOrderId ?? null, event.provider],
    );
    await client.query('COMMIT');
    notify = {
      couponCode: row.coupon_code,
      phone: row.customer_phone,
      orderNumber: row.order_number,
      grandTotal,
      customerName: row.customer_name || 'there',
      storeName: row.store_name || '',
    };
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    await recordFailedStorePaymentEvent(businessId, orderId, event, e).catch((err) => {
      console.error('[store payment event]', err);
    });
    throw e;
  } finally {
    client.release();
  }

  const { incrementStoreCouponUse } = await import('@/lib/store/coupons');
  await incrementStoreCouponUse(businessId, notify.couponCode);
  const { notifyStoreEvent } = await import('@/lib/store/notify-whatsapp');
  const paidTotal = notify.grandTotal.toLocaleString('en-IN');
  void notifyStoreEvent({
    businessId,
    eventKey: 'store_order_paid',
    phone: notify.phone,
    values: {
      customer_name: notify.customerName,
      order_number: notify.orderNumber,
      store_name: notify.storeName,
      total: paidTotal,
      payment_mode: 'Paid online',
    },
    text: `Order ${notify.orderNumber} is paid. Total ₹${paidTotal}. Thank you.`,
  });

  await reconcilePaidStoreOrder(orderId, businessId);
  return { outcome: 'fulfilled' };
}

/** Invoice failures that another delivery cannot fix. */
function retryableStoreInvoiceError(code: string): boolean {
  return ![
    'ORDER_CANCELLED',
    'STORE_ORDER_EMPTY',
    'STORE_LINE_NOT_REPRESENTABLE',
    'STORE_TAX_NOT_REPRESENTABLE',
    'STORE_TOTALS_NOT_REPRESENTABLE',
    'ACTOR_REQUIRED',
    'ACTOR_MISMATCH',
    'STORE_PAYMENT_NOT_VERIFIED',
    'PAYMENT_AMOUNT_MISMATCH',
    'STORE_ORDER_ALREADY_INVOICED',
  ].includes(code);
}

async function reconcilePaidStoreOrder(orderId: string, businessId: string): Promise<void> {
  const row = await getPool().query<{ payment_status: string }>(
    `SELECT payment_status FROM store_orders WHERE id = $1 AND business_id = $2`,
    [orderId, businessId],
  );
  if (row.rows[0]?.payment_status !== 'paid') return;
  const { settleStoreOrderReceipt, StoreReceiptPendingError } = await import('@/lib/store/store-receipt');
  try {
    const invoiceId = await createInvoiceForStoreOrder(orderId, businessId);
    if (!invoiceId) return;
  } catch (err) {
    console.error('[store invoice]', err);
    if (err instanceof StoreInvoiceError && !retryableStoreInvoiceError(err.code)) return;
    throw new StoreReceiptPendingError('The store invoice is not posted yet');
  }
  let settled: Awaited<ReturnType<typeof settleStoreOrderReceipt>>;
  try {
    settled = await settleStoreOrderReceipt(orderId, businessId);
  } catch (err) {
    console.error('[store receipt]', err);
    throw new StoreReceiptPendingError('The store receipt is not posted yet');
  }
  if (settled.outcome === 'skipped' && settled.reason === 'NO_INVOICE') {
    throw new StoreReceiptPendingError('The store invoice is not posted yet');
  }
}

/** A failed provider attempt does not post a receipt or mark the order paid. */
export async function recordStorePaymentFailure(
  orderId: string,
  businessId: string,
  event: StorePaymentEvent,
): Promise<'failed' | 'ignored'> {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const order = await client.query<{ payment_status: string }>(
      `SELECT payment_status FROM store_orders WHERE id = $1 AND business_id = $2 FOR UPDATE`,
      [orderId, businessId],
    );
    if (!order.rows[0] || order.rows[0].payment_status !== 'unpaid') {
      await client.query('ROLLBACK');
      return 'ignored';
    }
    await client.query(
      `INSERT INTO store_payment_events
         (business_id, order_id, provider, idempotency_key, payload, amount, status, error_message, processed_at)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6, 'rejected', 'PAYMENT_FAILED', CURRENT_TIMESTAMP)
       ON CONFLICT (provider, idempotency_key) DO NOTHING`,
      [businessId, orderId, event.provider, event.idempotencyKey, event.payload, event.amount ?? null],
    );
    await client.query(
      `UPDATE store_orders SET payment_status = 'failed', updated_at = CURRENT_TIMESTAMP
        WHERE id = $1 AND business_id = $2 AND payment_status = 'unpaid'`,
      [orderId, businessId],
    );
    await client.query('COMMIT');
    return 'failed';
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

/** Keeps the event retryable; never overwrites an event another delivery already processed. */
async function recordFailedStorePaymentEvent(
  businessId: string,
  orderId: string,
  event: StorePaymentEvent,
  error: unknown,
): Promise<void> {
  const message = error instanceof Error ? error.message : String(error);
  await getPool().query(
    `INSERT INTO store_payment_events
       (business_id, order_id, provider, idempotency_key, payload, amount, status, error_message)
     VALUES ($1, (SELECT id FROM store_orders WHERE id = $2 AND business_id = $1),
             $3, $4, $5::jsonb, $6, 'failed', $7)
     ON CONFLICT (provider, idempotency_key) DO UPDATE
       SET error_message = EXCLUDED.error_message
       WHERE store_payment_events.status = 'failed'`,
    [businessId, orderId, event.provider, event.idempotencyKey, event.payload, event.amount ?? null, message],
  );
}

export class StoreInvoiceError extends Error {
  constructor(
    message: string,
    public code: string,
  ) {
    super(message);
    this.name = 'StoreInvoiceError';
  }
}

type StoreOrderLine = {
  item_id: string;
  variant_id: string | null;
  item_name: string;
  quantity: string;
  unit: string | null;
  unit_price: string;
  tax_rate: string;
  line_total: string;
};

function classifyStoreLine(line: StoreOrderLine): 'inclusive' | 'exclusive' {
  const qty = parseFloat(line.quantity) || 0;
  const unit = parseFloat(line.unit_price) || 0;
  const rate = parseFloat(line.tax_rate) || 0;
  const lineTotal = parseFloat(line.line_total) || 0;
  const gross = roundMoney(unit * qty);
  const exclusive = roundMoney(gross * (1 + rate / 100));
  const tol = 0.02;
  if (rate <= 0) return 'exclusive';
  const looksInclusive = Math.abs(lineTotal - gross) <= tol;
  const looksExclusive = Math.abs(lineTotal - exclusive) <= tol;
  if (looksInclusive && !looksExclusive) return 'inclusive';
  if (looksExclusive && !looksInclusive) return 'exclusive';
  throw new StoreInvoiceError(
    `Line "${line.item_name}" total does not match an exclusive or inclusive GST price`,
    'STORE_LINE_NOT_REPRESENTABLE',
  );
}

/**
 * Warehouse mode requires a location on every goods line. Store checkout has no warehouse
 * picker, so the branch default warehouse is the sale location. Without it the invoice
 * service refuses the sale and no ledger is posted.
 */
async function storeInvoiceWarehouseId(
  client: import('pg').PoolClient,
  businessId: string,
  branchId: string,
): Promise<string | null> {
  const { isWarehouseModeEnabled } = await import('@/lib/warehouse-mode');
  if (!(await isWarehouseModeEnabled(businessId))) return null;
  const found = await client.query<{ id: string }>(
    `SELECT get_default_warehouse_for_branch($1) AS id`,
    [branchId],
  );
  const locationId = found.rows[0]?.id ?? null;
  if (!locationId) {
    throw new StoreInvoiceError(
      'Warehouse required for this store order. Set a default warehouse for the branch.',
      'WAREHOUSE_REQUIRED',
    );
  }
  return locationId;
}

/**
 * The shopper's customer record, matched on the last 10 phone digits, or created from the order.
 * Store invoices always carry a customer so the sale lands in that customer's ledger and a
 * later receipt (gateway or cash collected) can settle it.
 */
async function storeOrderCustomerId(
  client: import('pg').PoolClient,
  businessId: string,
  branchId: string,
  o: {
    customer_name: string;
    customer_phone: string;
    customer_address: string | null;
    customer_email: string | null;
    customer_pincode: string | null;
  },
): Promise<string | null> {
  const phone = String(o.customer_phone || '').replace(/\D/g, '');
  if (phone.length < 10) return null;
  const found = await client.query<{ id: string }>(
    `SELECT id FROM customers
      WHERE business_id = $1 AND deleted_at IS NULL
        AND right(regexp_replace(COALESCE(phone, ''), '\\D', '', 'g'), 10) = right($2, 10)
      ORDER BY created_at ASC
      LIMIT 1`,
    [businessId, phone],
  );
  if (found.rows[0]) return found.rows[0].id;
  const name = String(o.customer_name || '').trim() || `Store customer ${phone.slice(-4)}`;
  const created = await client.query<{ id: string }>(
    `INSERT INTO customers
       (business_id, branch_id, name, phone, email, billing_address, shipping_address, pincode, notes)
     VALUES ($1, $2, $3, $4, $5, $6, $6, $7, 'Created from online store order')
     RETURNING id`,
    [businessId, branchId, name, phone.slice(-10), o.customer_email || null, o.customer_address || null, o.customer_pincode || null],
  );
  return created.rows[0].id;
}

const storeInvoiceRetryAfter = new Map<string, number>();

/**
 * Posts store sales that were saved but never invoiced (and receipts for paid orders).
 * Safe to call more than once: an order that already has an invoice is not posted again.
 * Returns how many invoices or receipts were newly written.
 */
export async function accountOutstandingStoreOrders(
  businessId: string,
  actorUserId?: string | null,
): Promise<number> {
  const now = Date.now();
  const rows = await getPool().query<{ id: string; payment_status: string; invoice_id: string | null }>(
    `SELECT id, payment_status, invoice_id
       FROM store_orders
      WHERE business_id = $1
        AND status <> 'cancelled'
        AND (
          (invoice_id IS NULL AND payment_status IN ('paid', 'cod'))
          OR (payment_status = 'paid' AND invoice_id IS NOT NULL AND receipt_payment_id IS NULL)
        )
      ORDER BY created_at ASC
      LIMIT 25`,
    [businessId],
  );
  let posted = 0;
  for (const row of rows.rows) {
    if ((storeInvoiceRetryAfter.get(row.id) ?? 0) > now) continue;
    try {
      const invoiceId = await createInvoiceForStoreOrder(row.id, businessId, actorUserId ?? undefined);
      if (invoiceId && !row.invoice_id) posted += 1;
      if (row.payment_status === 'paid' && invoiceId) {
        const { settleStoreOrderReceipt } = await import('@/lib/store/store-receipt');
        const settled = await settleStoreOrderReceipt(row.id, businessId);
        if (settled.outcome === 'posted') posted += 1;
      }
      storeInvoiceRetryAfter.delete(row.id);
    } catch (err) {
      storeInvoiceRetryAfter.set(row.id, now + 60_000);
      console.error('[store invoice]', row.id, err);
    }
  }
  return posted;
}

/**
 * Finalises one store order as a normal final sales invoice.
 * The order row is locked. Accounting, GST and the order→invoice link commit together.
 * A second call returns the invoice already linked and does not post again.
 *
 * `actorUserId`, when passed, must be a user of `businessId` (the session user).
 * It is never taken from a request body. Public checkout and the payment webhook
 * omit it; the business primary admin, or the oldest active user, is the author.
 */
export async function createInvoiceForStoreOrder(
  orderId: string,
  businessId: string,
  actorUserId?: string | null,
): Promise<string | null> {
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const order = await client.query(
      `SELECT * FROM store_orders WHERE id = $1 AND business_id = $2 FOR UPDATE`,
      [orderId, businessId],
    );
    const o = order.rows[0] as
      | {
          invoice_id: string | null;
          branch_id: string | null;
          grand_total: string;
          tax_total: string;
          delivery_charge: string;
          discount_amount: string;
          order_number: string;
          payment_status: string;
          payment_provider: string | null;
          status: string;
          customer_name: string;
          customer_phone: string;
          customer_address: string | null;
          customer_email: string | null;
          customer_pincode: string | null;
          created_at: Date | string;
        }
      | undefined;
    if (!o) {
      await client.query('ROLLBACK');
      return null;
    }
    if (o.invoice_id) {
      await client.query('COMMIT');
      return o.invoice_id;
    }
    if (o.status === 'cancelled') {
      throw new StoreInvoiceError('A cancelled store order cannot be invoiced', 'ORDER_CANCELLED');
    }

    const grand = parseFloat(String(o.grand_total)) || 0;
    if (o.payment_status === 'paid') {
      const events = await client.query<{ amount: string | null }>(
        `SELECT amount::text AS amount FROM store_payment_events
          WHERE order_id = $1 AND business_id = $2 AND status = 'processed'`,
        [orderId, businessId],
      );
      if (events.rows.length === 0) {
        throw new StoreInvoiceError(
          'Paid store order has no verified payment',
          'STORE_PAYMENT_NOT_VERIFIED',
        );
      }
      const matches = events.rows.every((e) =>
        storePaymentAmountMatches(e.amount == null ? null : parseFloat(e.amount), grand),
      );
      if (!matches) {
        throw new StoreInvoiceError(
          'Payment amount does not match the order total',
          'PAYMENT_AMOUNT_MISMATCH',
        );
      }
    }

    const itemRes = await client.query<StoreOrderLine>(
      `SELECT item_id, variant_id, item_name, quantity::text, unit, unit_price::text,
              tax_rate::text, line_total::text
         FROM store_order_items WHERE order_id = $1`,
      [orderId],
    );
    const lines = itemRes.rows;
    if (lines.length === 0) {
      throw new StoreInvoiceError('Store order has no lines to invoice', 'STORE_ORDER_EMPTY');
    }

    const kinds = new Set(lines.map(classifyStoreLine));
    if (kinds.size > 1) {
      throw new StoreInvoiceError(
        'This order mixes GST-inclusive and GST-exclusive prices, which one invoice cannot represent',
        'STORE_TAX_NOT_REPRESENTABLE',
      );
    }
    const pricesIncludeGst = kinds.has('inclusive');
    const delivery = parseFloat(String(o.delivery_charge)) || 0;
    const discount = parseFloat(String(o.discount_amount)) || 0;
    const additional = roundMoney(delivery - discount);

    let createdBy = actorUserId || null;
    if (createdBy) {
      const actor = await client.query(
        `SELECT id FROM users WHERE id = $1 AND business_id = $2`,
        [createdBy, businessId],
      );
      if (actor.rows.length === 0) {
        throw new StoreInvoiceError('Actor does not belong to this business', 'ACTOR_MISMATCH');
      }
    } else {
      const admin = await client.query<{ id: string }>(
        `SELECT id FROM users
          WHERE business_id = $1 AND COALESCE(is_active, true) = true
          ORDER BY COALESCE(is_primary_admin, false) DESC, created_at ASC
          LIMIT 1`,
        [businessId],
      );
      if (admin.rows.length === 0) {
        throw new StoreInvoiceError('No business user available to author the invoice', 'ACTOR_REQUIRED');
      }
      createdBy = admin.rows[0].id;
    }

    const branchId = o.branch_id || (await resolveBranchId({ businessId, branchId: null }));
    const customerId = await storeOrderCustomerId(client, businessId, branchId, o);
    const locationId = await storeInvoiceWarehouseId(client, businessId, branchId);

    const invoiceDate = new Date(o.created_at).toISOString().slice(0, 10);
    const payLabel =
      o.payment_provider === 'upi'
        ? 'UPI'
        : o.payment_status === 'cod'
          ? 'COD'
          : o.payment_status === 'paid'
            ? storeProviderLabel(o.payment_provider)
            : 'Unpaid';
    const result = await createInvoiceInTransaction(
      client,
      {
        business_id: businessId,
        created_by: createdBy,
        branch_id: branchId,
        customer_id: customerId,
        invoice_date: invoiceDate,
        status: 'final',
        document_type: 'tax_invoice',
        prices_include_gst: pricesIncludeGst,
        additional_charges: additional,
        billing_address: o.customer_address,
        notes: `Online store order ${o.order_number} (${payLabel})`,
        items: lines.map((line) => ({
          item_id: line.item_id,
          variant_id: line.variant_id,
          item_name: line.item_name,
          quantity: parseFloat(line.quantity) || 0,
          unit: line.unit || 'PCS',
          unit_price: parseFloat(line.unit_price) || 0,
          tax_rate: parseFloat(line.tax_rate) || 0,
          location_id: locationId,
        })),
      },
    );

    const orderTax = parseFloat(String(o.tax_total)) || 0;
    if (
      Math.abs(result.grandTotal - grand) > 0.02 ||
      Math.abs(result.taxTotal - orderTax) > 0.05
    ) {
      throw new StoreInvoiceError(
        `Store order totals cannot be represented on a normal invoice (order ${grand}/${orderTax}, invoice ${result.grandTotal}/${result.taxTotal})`,
        'STORE_TOTALS_NOT_REPRESENTABLE',
      );
    }

    await client.query(`UPDATE invoices SET store_order_id = $1 WHERE id = $2 AND business_id = $3`, [
      orderId,
      result.invoiceId,
      businessId,
    ]);
    const linked = await client.query(
      `UPDATE store_orders
          SET invoice_id = $1, updated_at = CURRENT_TIMESTAMP
        WHERE id = $2 AND business_id = $3 AND invoice_id IS NULL`,
      [result.invoiceId, orderId, businessId],
    );
    if (linked.rowCount !== 1) {
      throw new StoreInvoiceError('Store order was already invoiced', 'STORE_ORDER_ALREADY_INVOICED');
    }

    await client.query('COMMIT');
    return result.invoiceId;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}
