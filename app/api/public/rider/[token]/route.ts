import { NextRequest, NextResponse } from 'next/server';
import { checkRateLimit } from '@/lib/rate-limit';
import { applyRiderUpdate, isRiderAction, isRiderToken, loadRiderDrop } from '@/lib/fulfilment/rider';
import { triggerFulfilmentNotification } from '@/lib/fulfilment/notify-trigger';
import { getClientIp } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

type Ctx = { params: { token: string } };

function ip(request: NextRequest): string {
  return getClientIp(request);
}

/** Drop details for the rider holding this link. */
export async function GET(request: NextRequest, { params }: Ctx) {
  if (!checkRateLimit(`rider-link:${ip(request)}`, 60, 60_000).allowed) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
  }
  if (!isRiderToken(params.token)) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const drop = await loadRiderDrop(params.token);
  if (!drop) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json(drop, { headers: { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' } });
}

/** { action: 'out_for_delivery' | 'delivered' | 'delivery_failed' | 'cod_collected', reason?, cash_collected? } */
export async function POST(request: NextRequest, { params }: Ctx) {
  if (!checkRateLimit(`rider-link-post:${ip(request)}`, 20, 60_000).allowed) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
  }
  if (!isRiderToken(params.token)) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  if (!isRiderAction(body.action)) return NextResponse.json({ error: 'Unknown action' }, { status: 400 });

  const result = await applyRiderUpdate(params.token, {
    action: body.action,
    reason: typeof body.reason === 'string' ? body.reason : null,
    cashCollected: body.cash_collected === true,
    onStoreCash: async (storeOrderId, businessId) => {
      const { createInvoiceForStoreOrder } = await import('@/lib/store/fulfill-paid-order');
      const { collectStoreOrderCash } = await import('@/lib/store/store-receipt');
      await createInvoiceForStoreOrder(storeOrderId, businessId);
      await collectStoreOrderCash(storeOrderId, businessId, null);
    },
  });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });

  // Store orders keep their coarse status in step with the parcel.
  if (result.storeOrderId && result.to === 'delivered') {
    const { transitionStoreOrder } = await import('@/lib/store/order-lifecycle');
    await transitionStoreOrder({
      businessId: result.businessId,
      orderId: result.storeOrderId,
      to: 'delivered',
      skipFulfilmentSync: true,
    }).catch((err) => console.error('[rider store sync]', err));
  }
  if (result.change) triggerFulfilmentNotification(result.businessId, result.change);
  return NextResponse.json(await loadRiderDrop(params.token));
}
