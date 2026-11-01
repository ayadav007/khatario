import { NextRequest, NextResponse } from 'next/server';
import {
  parseShiprocketWebhook,
  SHIPROCKET_WEBHOOK_TOKEN_HEADER,
} from '@/lib/store/delivery/webhooks';
import {
  applyShiprocketTrackingUpdate,
  resolveBusinessIdForShiprocketToken,
} from '@/lib/store/order-lifecycle';
import { applyShiprocketReturnUpdate } from '@/lib/returns/pickup';
import { triggerFulfilmentNotification } from '@/lib/fulfilment/notify-trigger';
import { applyShiprocketFulfilmentUpdate, noteRtoInProgress } from '@/lib/fulfilment/shiprocket-booking';

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

  // Return shipments first: their labels (DELIVERED, RTO ...) must never reach forward handling.
  const returned = await applyShiprocketReturnUpdate({
    businessId,
    awb: parsed.awb,
    srOrderId: parsed.srOrderId,
    label: parsed.label,
    qcFailureReason: parsed.qcFailureReason,
  });
  if (returned.outcome !== 'not_found') return NextResponse.json({ ok: true, ...returned });
  if (parsed.isReturn) return NextResponse.json({ ok: true, ignored: true });

  if (parsed.rtoInProgress) {
    // Coming back, not back yet: nothing is cancelled or returned, the timeline just says so.
    const found = await noteRtoInProgress({
      businessId,
      awb: parsed.awb,
      srOrderId: parsed.srOrderId,
      label: parsed.label,
    });
    return NextResponse.json({ ok: true, outcome: found ? 'rto_noted' : 'not_found' });
  }
  if (!parsed.status || (!parsed.awb && !parsed.orderRef && !parsed.srOrderId)) {
    return NextResponse.json({ ok: true, ignored: true });
  }

  const result = await applyShiprocketTrackingUpdate({
    businessId,
    awb: parsed.awb,
    orderRef: parsed.orderRef,
    srOrderId: parsed.srOrderId,
    status: parsed.status,
    fulfilmentStatus: parsed.fulfilmentStatus,
  });
  if (result.outcome === 'not_found') {
    const other = await applyShiprocketFulfilmentUpdate({
      businessId,
      awb: parsed.awb,
      srOrderId: parsed.srOrderId,
      fulfilmentStatus: parsed.fulfilmentStatus,
    });
    if (other.outcome === 'updated') triggerFulfilmentNotification(businessId, other.fulfilment ?? null);
    return NextResponse.json({ ok: true, outcome: other.outcome });
  }
  if (result.outcome === 'updated') triggerFulfilmentNotification(businessId, result.fulfilment);
  // Shiprocket expects 200 for every delivered event; out-of-order statuses are acknowledged, not applied.
  return NextResponse.json({ ok: true, ...result });
}
