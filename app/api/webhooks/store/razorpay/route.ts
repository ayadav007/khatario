import { NextRequest, NextResponse } from 'next/server';
import { queryOne } from '@/lib/db';
import { getBusinessPaymentProviderConfig } from '@/lib/payments/business-provider-config';
import { RazorpayPaymentProvider } from '@/lib/payments/providers/razorpay-payment-provider';
import { fulfillStoreOrderPayment } from '@/lib/store/fulfill-paid-order';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const rawBody = await request.text();
  let parsed: Record<string, unknown> = {};
  try {
    parsed = JSON.parse(rawBody) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const notes = extractNotes(parsed);
  const orderId = String(notes.store_order_id || notes.khatario_sales_order_id || '');
  const businessId = String(notes.business_id || '');
  if (!orderId || !businessId) {
    return NextResponse.json({ ok: true, ignored: true });
  }

  const cfg = await getBusinessPaymentProviderConfig(businessId, 'razorpay');
  if (!cfg) {
    return NextResponse.json({ error: 'Unknown store payment config' }, { status: 400 });
  }

  const headers: Record<string, string> = {};
  request.headers.forEach((v, k) => {
    headers[k.toLowerCase()] = v;
  });

  const rzp = new RazorpayPaymentProvider(cfg);
  const verified = await rzp.verifyWebhook({ rawBody, headers, webhookSecret: cfg.clientSecret });
  if (!verified.verified || verified.status !== 'success') {
    return NextResponse.json({ ok: true, verified: verified.verified });
  }

  const idem =
    verified.providerPaymentId ||
    `store|${orderId}|${verified.eventType || 'paid'}`;
  const inserted = await queryOne<{ id: string }>(
    `INSERT INTO store_payment_events (business_id, order_id, provider, idempotency_key, payload)
     VALUES ($1, $2, 'razorpay', $3, $4::jsonb)
     ON CONFLICT (provider, idempotency_key) DO NOTHING
     RETURNING id`,
    [businessId, orderId, idem, rawBody],
  );
  if (!inserted) {
    return NextResponse.json({ ok: true, duplicate: true });
  }

  await fulfillStoreOrderPayment(orderId, businessId);
  return NextResponse.json({ ok: true });
}

function extractNotes(body: Record<string, unknown>): Record<string, string> {
  const payload = body.payload as Record<string, unknown> | undefined;
  const plink = (payload?.payment_link as Record<string, unknown> | undefined)?.entity as
    | Record<string, unknown>
    | undefined;
  const notes = (plink?.notes || body.notes) as Record<string, string> | undefined;
  return notes && typeof notes === 'object' ? notes : {};
}
