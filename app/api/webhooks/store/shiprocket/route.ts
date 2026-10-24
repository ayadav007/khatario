import { NextRequest, NextResponse } from 'next/server';
import {
  parseShiprocketWebhook,
  SHIPROCKET_WEBHOOK_TOKEN_HEADER,
} from '@/lib/store/delivery/webhooks';
import {
  applyShiprocketTrackingUpdate,
  resolveBusinessIdForShiprocketToken,
} from '@/lib/store/order-lifecycle';
import { triggerFulfilmentNotification } from '@/lib/fulfilment/notify-trigger';
import { applyShiprocketFulfilmentUpdate } from '@/lib/fulfilment/shiprocket-booking';

export const dynamic = 'force-dynamic';

/**
 * Shiprocket tracking updates. The x-api-key token set in the merchant's Shiprocket dashboard
 * identifies the business; orders of any other business are never matched.
 */
export async function POST(request: NextRequest) {
  const token = request.headers.get(SHIPROCKET_WEBHOOK_TOKEN_HEADER)?.trim() ?? '';
  const businessId = await resolveBusinessIdForShiprocketToken(token);
  if (!businessId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const parsed = parseShiprocketWebhook(body);
  if (!parsed.status || (!parsed.awb && !parsed.orderRef)) {
    return NextResponse.json({ ok: true, ignored: true });
  }

  const result = await applyShiprocketTrackingUpdate({
    businessId,
    awb: parsed.awb,
    orderRef: parsed.orderRef,
    status: parsed.status,
    fulfilmentStatus: parsed.fulfilmentStatus,
  });
  if (result.outcome === 'not_found') {
    const other = await applyShiprocketFulfilmentUpdate({
      businessId,
      awb: parsed.awb,
      orderRef: parsed.orderRef,
      fulfilmentStatus: parsed.fulfilmentStatus,
    });
    if (other.outcome === 'updated') triggerFulfilmentNotification(businessId, other.fulfilment ?? null);
    return NextResponse.json({ ok: true, outcome: other.outcome });
  }
  if (result.outcome === 'updated') triggerFulfilmentNotification(businessId, result.fulfilment);
  // Shiprocket expects 200 for every delivered event; out-of-order statuses are acknowledged, not applied.
  return NextResponse.json({ ok: true, ...result });
}
