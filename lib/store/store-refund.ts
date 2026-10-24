import { randomUUID } from 'crypto';
import { getPool } from '@/lib/db';
import { reverseVoucherLedgerEntries } from '@/lib/ledger-reversal';
import { recomputeInvoiceBalance } from '@/lib/invoices/invoice-balance';
import { getBusinessPaymentProviderConfig } from '@/lib/payments/business-provider-config';
import { RazorpayPaymentProvider } from '@/lib/payments/providers/razorpay-payment-provider';
import { EasebuzzPaymentProvider } from '@/lib/payments/providers/easebuzz-payment-provider';
import type { StoreOnlinePaymentProvider } from '@/lib/store/fulfill-paid-order';

export const STORE_REFUND_WEBHOOK_ACTOR = 'razorpay_webhook' as const;
export const STORE_REFUND_EASEBUZZ_ACTOR = 'easebuzz_webhook' as const;
export type StoreRefundProviderActor =
  | typeof STORE_REFUND_WEBHOOK_ACTOR
  | typeof STORE_REFUND_EASEBUZZ_ACTOR;

function storeRefundProvider(value: string | null | undefined): StoreOnlinePaymentProvider {
  return value === 'easebuzz' ? 'easebuzz' : 'razorpay';
}

function providerActor(provider: StoreOnlinePaymentProvider): StoreRefundProviderActor {
  return provider === 'easebuzz' ? STORE_REFUND_EASEBUZZ_ACTOR : STORE_REFUND_WEBHOOK_ACTOR;
}

function providerLabel(provider: StoreOnlinePaymentProvider): string {
  return provider === 'easebuzz' ? 'Easebuzz' : 'Razorpay';
}

export class StoreRefundError extends Error {
  constructor(
    message: string,
    public statusCode: number,
    public code: string,
  ) {
    super(message);
    this.name = 'StoreRefundError';
  }
}

export type StoreRefundSubmit = {
  action: 'submit';
  refundId: string;
  idempotencyKey: string;
  providerPaymentId: string;
  amountPaise: number;
  provider: StoreOnlinePaymentProvider;
};

export type StoreRefundPrepare =
  | { action: 'complete'; providerRefundId: string | null }
  | StoreRefundSubmit;

type RefundCaller =
  | { actorType: 'user'; actorUserId: string }
  | { actorType: StoreRefundProviderActor; actorUserId: null };

/**
 * Records a refund request and commits it before any provider call.
 * A second call for the same order returns the same idempotency key.
 */
export async function prepareStoreRefund(input: {
  businessId: string;
  orderId: string;
  actorUserId: string;
}): Promise<StoreRefundPrepare> {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const user = await client.query(
      `SELECT id FROM users WHERE id = $1 AND business_id = $2`,
      [input.actorUserId, input.businessId],
    );
    if (user.rows.length === 0) {
      throw new StoreRefundError('Actor does not belong to this business', 403, 'ACTOR_MISMATCH');
    }
    const prepared = await claimRefund(client, input.businessId, input.orderId, {
      actorType: 'user',
      actorUserId: input.actorUserId,
    });
    await client.query('COMMIT');
    return prepared;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Applies a provider refund result. Posts the payment reversal once, and only
 * when the provider reports the refund processed. Does not reverse the sales invoice.
 */
export async function applyStoreRefundResult(input: {
  businessId: string;
  refundId: string;
  providerRefundId: string;
  providerStatus: 'processed' | 'pending';
  actorType: 'user' | StoreRefundProviderActor;
}): Promise<{ status: 'pending' | 'refunded'; paymentReversals: number }> {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const locked = await client.query<{
      id: string;
      order_id: string;
      payment_id: string;
      amount: string;
      status: string;
      provider_refund_id: string | null;
      actor_type: string;
      actor_user_id: string | null;
      provider: string;
    }>(
      `SELECT id, order_id, payment_id, amount::text, status, provider_refund_id,
              actor_type, actor_user_id, provider
         FROM store_payment_refunds
        WHERE id = $1 AND business_id = $2
        FOR UPDATE`,
      [input.refundId, input.businessId],
    );
    const refund = locked.rows[0];
    if (!refund) throw new StoreRefundError('Refund not found', 404, 'REFUND_NOT_FOUND');
    if (refund.status === 'refunded') {
      await client.query('COMMIT');
      return { status: 'refunded', paymentReversals: 0 };
    }
    if (
      refund.provider_refund_id &&
      refund.provider_refund_id !== input.providerRefundId
    ) {
      throw new StoreRefundError('This payment already has a different refund', 409, 'REFUND_CONFLICT');
    }

    await client.query(
      `UPDATE store_payment_refunds
          SET provider_refund_id = $3, updated_at = CURRENT_TIMESTAMP
        WHERE id = $1 AND business_id = $2`,
      [refund.id, input.businessId, input.providerRefundId],
    );

    if (input.providerStatus !== 'processed') {
      await client.query(
        `UPDATE store_orders SET payment_status = 'refund_pending', updated_at = CURRENT_TIMESTAMP
          WHERE id = $1 AND business_id = $2 AND payment_status IN ('paid', 'refund_pending')`,
        [refund.order_id, input.businessId],
      );
      await client.query('COMMIT');
      return { status: 'pending', paymentReversals: 0 };
    }

    const paymentReversals = await reverseVoucherLedgerEntries(client, {
      businessId: input.businessId,
      voucherType: 'payment',
      voucherId: refund.payment_id,
      reason: `${providerLabel(storeRefundProvider(refund.provider))} refund ${input.providerRefundId}`,
      actorId: refund.actor_type === 'user' ? refund.actor_user_id : null,
    });
    if (paymentReversals > 0) {
      const pay = await client.query<{ customer_id: string | null; reference_id: string | null }>(
        `SELECT customer_id, reference_id FROM payments WHERE id = $1 AND business_id = $2`,
        [refund.payment_id, input.businessId],
      );
      const amount = parseFloat(refund.amount) || 0;
      const customerId = pay.rows[0]?.customer_id;
      const invoiceId = pay.rows[0]?.reference_id;
      if (customerId) {
        await client.query(
          `UPDATE customers SET current_balance = current_balance + $1, updated_at = CURRENT_TIMESTAMP
            WHERE id = $2 AND business_id = $3`,
          [amount, customerId, input.businessId],
        );
      }
      if (invoiceId) {
        const inv = await client.query<{ status: string }>(
          `SELECT status FROM invoices WHERE id = $1 AND business_id = $2 FOR UPDATE`,
          [invoiceId, input.businessId],
        );
        if (inv.rows[0]?.status === 'final') {
          await client.query(
            `UPDATE invoices SET paid_amount = GREATEST(0, COALESCE(paid_amount, 0) - $1)
              WHERE id = $2 AND business_id = $3`,
            [amount, invoiceId, input.businessId],
          );
          await recomputeInvoiceBalance(client, invoiceId, input.businessId);
        }
      }
    }

    await client.query(
      `UPDATE store_payment_refunds SET status = 'refunded', updated_at = CURRENT_TIMESTAMP
        WHERE id = $1 AND business_id = $2`,
      [refund.id, input.businessId],
    );
    await client.query(
      `UPDATE store_orders SET payment_status = 'refunded', updated_at = CURRENT_TIMESTAMP
        WHERE id = $1 AND business_id = $2`,
      [refund.order_id, input.businessId],
    );
    await client.query('COMMIT');
    return { status: 'refunded', paymentReversals };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

export async function confirmStoreRefundFromProvider(input: {
  providerPaymentId: string;
  providerRefundId: string;
  amountInr: number | null;
  providerStatus: 'processed' | 'pending';
  provider?: StoreOnlinePaymentProvider;
}): Promise<{ status: 'pending' | 'refunded' | 'ignored'; businessId?: string }> {
  const provider = input.provider ?? 'razorpay';
  const found = await getPool().query<{ id: string; business_id: string; amount: string }>(
    `SELECT r.id, r.business_id, r.amount::text
       FROM store_payment_refunds r
       JOIN store_orders o ON o.id = r.order_id AND o.business_id = r.business_id
      WHERE o.provider_payment_id = $1
        AND COALESCE(o.payment_provider, 'razorpay') = $2
      LIMIT 1`,
    [input.providerPaymentId, provider],
  );
  let refund = found.rows[0];
  if (!refund) {
    const opened = await openWebhookRefund({ ...input, provider });
    if (!opened) return { status: 'ignored' };
    refund = opened;
  }
  if (input.amountInr != null && Math.round(input.amountInr * 100) !== Math.round(parseFloat(refund.amount) * 100)) {
    throw new StoreRefundError('Refund amount does not match the store payment', 409, 'REFUND_AMOUNT_MISMATCH');
  }
  const applied = await applyStoreRefundResult({
    businessId: refund.business_id,
    refundId: refund.id,
    providerRefundId: input.providerRefundId,
    providerStatus: input.providerStatus,
    actorType: providerActor(provider),
  });
  return { status: applied.status, businessId: refund.business_id };
}

export async function refundStoreOrder(input: {
  businessId: string;
  orderId: string;
  actorUserId: string;
  requestRefund?: (args: {
    providerPaymentId: string;
    amountPaise: number;
    idempotencyKey: string;
  }) => Promise<{ providerRefundId: string; status: 'processed' | 'pending' }>;
}): Promise<{ status: 'pending' | 'refunded'; providerRefundId: string | null }> {
  const prepared = await prepareStoreRefund(input);
  if (prepared.action === 'complete') {
    return { status: 'refunded', providerRefundId: prepared.providerRefundId };
  }
  const requestRefund =
    input.requestRefund ??
    (prepared.provider === 'easebuzz'
      ? await easebuzzRefundRequester(input.businessId)
      : await razorpayRefundRequester(input.businessId));
  const result = await requestRefund({
    providerPaymentId: prepared.providerPaymentId,
    amountPaise: prepared.amountPaise,
    idempotencyKey: prepared.idempotencyKey,
  });
  const applied = await applyStoreRefundResult({
    businessId: input.businessId,
    refundId: prepared.refundId,
    providerRefundId: result.providerRefundId,
    providerStatus: result.status,
    actorType: 'user',
  });
  return { status: applied.status, providerRefundId: result.providerRefundId };
}

async function razorpayRefundRequester(businessId: string) {
  const cfg = await getBusinessPaymentProviderConfig(businessId, 'razorpay');
  if (!cfg) throw new StoreRefundError('Online payment is not configured', 409, 'PAYMENT_NOT_CONFIGURED');
  const provider = new RazorpayPaymentProvider(cfg);
  return (args: { providerPaymentId: string; amountPaise: number; idempotencyKey: string }) =>
    provider.refundCapturedPayment(args);
}

/**
 * Easebuzz has no idempotency header, so a retry first asks Refund Status for our
 * merchant_refund_id and only raises a new refund when Easebuzz has none.
 */
async function easebuzzRefundRequester(businessId: string) {
  const cfg = await getBusinessPaymentProviderConfig(businessId, 'easebuzz');
  if (!cfg) throw new StoreRefundError('Online payment is not configured', 409, 'PAYMENT_NOT_CONFIGURED');
  const provider = new EasebuzzPaymentProvider(cfg);
  return async (args: { providerPaymentId: string; amountPaise: number; idempotencyKey: string }) => {
    const existing = await provider.fetchRefundStatus(args.providerPaymentId, args.idempotencyKey);
    if (existing?.status === 'failed') {
      throw new StoreRefundError('Easebuzz declined this refund', 502, 'REFUND_FAILED');
    }
    if (existing) {
      return {
        providerRefundId: existing.providerRefundId,
        status: existing.status === 'processed' ? ('processed' as const) : ('pending' as const),
      };
    }
    return provider.refundPayment({
      easebuzzId: args.providerPaymentId,
      amountPaise: args.amountPaise,
      merchantRefundId: args.idempotencyKey,
    });
  };
}

async function claimRefund(
  client: import('pg').PoolClient,
  businessId: string,
  orderId: string,
  actor: RefundCaller,
): Promise<StoreRefundPrepare> {
  const order = await client.query<{
    payment_status: string;
    provider_payment_id: string | null;
    payment_ref: string | null;
    receipt_payment_id: string | null;
    grand_total: string;
    payment_provider: string | null;
  }>(
    `SELECT payment_status, provider_payment_id, payment_ref, receipt_payment_id, grand_total::text,
            payment_provider
       FROM store_orders
      WHERE id = $1 AND business_id = $2
      FOR UPDATE`,
    [orderId, businessId],
  );
  const row = order.rows[0];
  if (!row) throw new StoreRefundError('Order not found', 404, 'ORDER_NOT_FOUND');
  const provider = storeRefundProvider(row.payment_provider);
  if (row.payment_status === 'refunded') {
    const done = await client.query<{ provider_refund_id: string | null }>(
      `SELECT provider_refund_id FROM store_payment_refunds WHERE order_id = $1 AND business_id = $2`,
      [orderId, businessId],
    );
    return { action: 'complete', providerRefundId: done.rows[0]?.provider_refund_id ?? null };
  }
  if (row.payment_status !== 'paid' && row.payment_status !== 'refund_pending') {
    throw new StoreRefundError('Only a paid store order can be refunded', 409, 'NOT_PAID');
  }
  if (!row.provider_payment_id) {
    throw new StoreRefundError('This order has no captured online payment', 409, 'NO_PROVIDER_PAYMENT');
  }
  if (!row.receipt_payment_id) {
    throw new StoreRefundError('This order has no posted receipt to reverse', 409, 'NO_RECEIPT');
  }

  const existing = await client.query<{
    id: string;
    idempotency_key: string;
    provider_refund_id: string | null;
    status: string;
    amount: string;
  }>(
    `SELECT id, idempotency_key, provider_refund_id, status, amount::text
       FROM store_payment_refunds
      WHERE order_id = $1 AND business_id = $2
      FOR UPDATE`,
    [orderId, businessId],
  );
  if (existing.rows[0]?.status === 'refunded') {
    return { action: 'complete', providerRefundId: existing.rows[0].provider_refund_id };
  }
  if (existing.rows[0]) {
    const current = existing.rows[0];
    return {
      action: 'submit',
      refundId: current.id,
      idempotencyKey: current.idempotency_key,
      providerPaymentId: row.provider_payment_id,
      amountPaise: Math.round(parseFloat(current.amount) * 100),
      provider,
    };
  }

  const refundId = randomUUID();
  const amount = parseFloat(row.grand_total) || 0;
  await client.query(
    `INSERT INTO store_payment_refunds (
       id, business_id, order_id, payment_id, provider, provider_payment_id, provider_order_id,
       idempotency_key, amount, currency, status, actor_type, actor_user_id
     ) VALUES ($1,$2,$3,$4,$11,$5,$6,$7,$8,'INR','pending',$9,$10)`,
    [
      refundId,
      businessId,
      orderId,
      row.receipt_payment_id,
      row.provider_payment_id,
      row.payment_ref,
      refundId,
      amount,
      actor.actorType,
      actor.actorUserId,
      provider,
    ],
  );
  await client.query(
    `UPDATE store_orders SET payment_status = 'refund_pending', updated_at = CURRENT_TIMESTAMP
      WHERE id = $1 AND business_id = $2`,
    [orderId, businessId],
  );
  return {
    action: 'submit',
    refundId,
    idempotencyKey: refundId,
    providerPaymentId: row.provider_payment_id,
    amountPaise: Math.round(amount * 100),
    provider,
  };
}

async function openWebhookRefund(input: {
  providerPaymentId: string;
  providerRefundId: string;
  amountInr: number | null;
  provider: StoreOnlinePaymentProvider;
}): Promise<{ id: string; business_id: string; amount: string } | null> {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const order = await client.query<{
      id: string;
      business_id: string;
      payment_status: string;
      receipt_payment_id: string | null;
      payment_ref: string | null;
      grand_total: string;
    }>(
      `SELECT id, business_id, payment_status, receipt_payment_id, payment_ref, grand_total::text
         FROM store_orders
        WHERE provider_payment_id = $1
          AND COALESCE(payment_provider, 'razorpay') = $2
        FOR UPDATE`,
      [input.providerPaymentId, input.provider],
    );
    const row = order.rows[0];
    if (!row || !row.receipt_payment_id) {
      await client.query('ROLLBACK');
      return null;
    }
    if (row.payment_status !== 'paid' && row.payment_status !== 'refund_pending') {
      await client.query('ROLLBACK');
      return null;
    }
    const amount = parseFloat(row.grand_total) || 0;
    if (input.amountInr != null && Math.round(input.amountInr * 100) !== Math.round(amount * 100)) {
      throw new StoreRefundError('Refund amount does not match the store payment', 409, 'REFUND_AMOUNT_MISMATCH');
    }
    const refundId = randomUUID();
    const key = input.providerRefundId.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64);
    const idempotencyKey = key.length >= 10 ? key : refundId;
    await client.query(
      `INSERT INTO store_payment_refunds (
         id, business_id, order_id, payment_id, provider, provider_payment_id, provider_order_id,
         idempotency_key, amount, currency, status, actor_type, actor_user_id
       ) VALUES ($1,$2,$3,$4,$9,$5,$6,$7,$8,'INR','pending',$10,NULL)
       ON CONFLICT (order_id) DO NOTHING`,
      [
        refundId,
        row.business_id,
        row.id,
        row.receipt_payment_id,
        input.providerPaymentId,
        row.payment_ref,
        idempotencyKey,
        amount,
        input.provider,
        providerActor(input.provider),
      ],
    );
    const saved = await client.query<{ id: string; business_id: string; amount: string }>(
      `SELECT id, business_id, amount::text FROM store_payment_refunds WHERE order_id = $1`,
      [row.id],
    );
    await client.query('COMMIT');
    return saved.rows[0] ?? null;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}
