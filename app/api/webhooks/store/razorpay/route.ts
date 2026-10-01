import { NextRequest, NextResponse } from 'next/server';
import { queryOne } from '@/lib/db';
import { getBusinessPaymentProviderConfig } from '@/lib/payments/business-provider-config';
import {
  RazorpayPaymentProvider,
  readRazorpayRefundNotice,
} from '@/lib/payments/providers/razorpay-payment-provider';
import { fulfillStoreOrderPayment, recordStorePaymentFailure } from '@/lib/store/fulfill-paid-order';
import { confirmStoreRefundFromProvider } from '@/lib/store/store-refund';

export const dynamic = 'force-dynamic';

/**
 * Razorpay payment and refund notices for store orders.
 * The order is the one whose payment link or captured payment id matches.
 * Notes in the payload are not used to choose the business or the user.
 */
export async function POST(request: NextRequest) {
  const rawBody = await request.text();
  let parsed: Record<string, unknown> = {};
  try {
    parsed = JSON.parse(rawBody) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const refs = unverifiedProviderRefs(parsed);
  const order = await findStoreOrderForRazorpay(refs);
  if (!order) {
    return NextResponse.json({ ok: true, ignored: true });
  }

  const cfg = await getBusinessPaymentProviderConfig(order.business_id, 'razorpay');
  if (!cfg) {
    return NextResponse.json({ error: 'Unknown store payment config' }, { status: 400 });
  }

  const headers: Record<string, string> = {};
  request.headers.forEach((v, k) => {
    headers[k.toLowerCase()] = v;
  });
  const verified = await new RazorpayPaymentProvider(cfg).verifyWebhook({
    rawBody,
    headers,
    webhookSecret: cfg.clientSecret,
  });
  if (!verified.verified) {
    return NextResponse.json({ ok: false, verified: false }, { status: 401 });
  }

  const refund = readRazorpayRefundNotice(parsed);
  if (refund.event.startsWith('refund.') && refund.providerPaymentId && refund.providerRefundId && refund.status) {
    try {
      const result = await confirmStoreRefundFromProvider({
        providerPaymentId: refund.providerPaymentId,
        providerRefundId: refund.providerRefundId,
        amountInr: refund.amountInr,
        providerStatus: refund.status,
      });
      return NextResponse.json({ ok: true, ...result });
    } catch (err) {
      console.error('[store razorpay refund webhook]', err);
      return NextResponse.json({ error: 'Refund confirmation failed' }, { status: 500 });
    }
  }

  if (verified.status === 'failed') {
    await recordStorePaymentFailure(order.id, order.business_id, {
      provider: 'razorpay',
      idempotencyKey: verified.providerPaymentId || `failed|${order.id}`,
      amount: verified.amount ?? null,
      currency: verified.currency,
      payload: rawBody,
    });
    return NextResponse.json({ ok: true, outcome: 'failed' });
  }

  if (verified.status !== 'success') {
    return NextResponse.json({ ok: true, verified: true, ignored: true });
  }

  const idem = verified.providerPaymentId || `store|${order.id}|${verified.eventType || 'paid'}`;
  try {
    const result = await fulfillStoreOrderPayment(order.id, order.business_id, {
      provider: 'razorpay',
      idempotencyKey: idem,
      amount: verified.amount,
      currency: verified.currency,
      payload: rawBody,
      providerPaymentId: verified.providerPaymentId,
      providerOrderId: verified.providerOrderId,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error('[store razorpay webhook]', err);
    return NextResponse.json({ error: 'Fulfilment failed' }, { status: 500 });
  }
}

function unverifiedProviderRefs(body: Record<string, unknown>): { paymentRef: string; providerPaymentId: string } {
  const payload = body.payload as Record<string, unknown> | undefined;
  const plink = (payload?.payment_link as Record<string, unknown> | undefined)?.entity as
    | Record<string, unknown>
    | undefined;
  const payment = (payload?.payment as Record<string, unknown> | undefined)?.entity as
    | Record<string, unknown>
    | undefined;
  const refund = (payload?.refund as Record<string, unknown> | undefined)?.entity as
    | Record<string, unknown>
    | undefined;
  const paymentRef = typeof plink?.id === 'string' ? plink.id : '';
  const providerPaymentId =
    (typeof payment?.id === 'string' && payment.id) ||
    (typeof refund?.payment_id === 'string' && refund.payment_id) ||
    '';
  return { paymentRef, providerPaymentId };
}

async function findStoreOrderForRazorpay(refs: { paymentRef: string; providerPaymentId: string }) {
  if (!refs.paymentRef && !refs.providerPaymentId) return null;
  return queryOne<{ id: string; business_id: string }>(
    `SELECT id, business_id FROM store_orders
      WHERE ($1 <> '' AND payment_ref = $1)
         OR ($2 <> '' AND provider_payment_id = $2)
      LIMIT 1`,
    [refs.paymentRef, refs.providerPaymentId],
  );
}
