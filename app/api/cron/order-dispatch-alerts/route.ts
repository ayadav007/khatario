import { NextRequest, NextResponse } from 'next/server';
import { queryOne, queryRows } from '@/lib/db';
import { assertCronAuthorized } from '@/lib/cron-auth';
import { orderHubNeedsCounts } from '@/lib/fulfilment/hub';
import { sanitizeOrderUpdateSettings } from '@/lib/fulfilment/update-settings';

export const dynamic = 'force-dynamic';

/**
 * GET/POST /api/cron/order-dispatch-alerts — WhatsApps the owner when paid orders have waited longer
 * than their dispatch time. Opt-in per business; at most one alert per business every 20 hours.
 */
export async function POST(request: NextRequest) {
  const denied = assertCronAuthorized(request);
  if (denied) return denied;

  const businesses = await queryRows<{ business_id: string; s: unknown; phone: string | null; name: string }>(
    `SELECT bs.business_id, bs.order_update_settings AS s, b.phone, b.name
       FROM business_settings bs
       JOIN businesses b ON b.id = bs.business_id
      WHERE (bs.order_update_settings->>'merchantDispatchAlert')::boolean IS TRUE
        AND b.platform_suspended_at IS NULL
        AND b.phone IS NOT NULL`,
  );

  let sent = 0;
  for (const biz of businesses) {
    try {
      const settings = sanitizeOrderUpdateSettings(biz.s);
      const counts = await orderHubNeedsCounts({ businessId: biz.business_id, branchIds: null }, settings.dispatchSlaHours);
      if (!counts.stale) continue;
      const claimed = await queryOne<{ business_id: string }>(
        `UPDATE business_settings
            SET order_update_settings = order_update_settings || jsonb_build_object('lastDispatchAlertAt', NOW()::text)
          WHERE business_id = $1
            AND COALESCE((order_update_settings->>'lastDispatchAlertAt')::timestamptz, 'epoch') < NOW() - INTERVAL '20 hours'
          RETURNING business_id`,
        [biz.business_id],
      );
      if (!claimed) continue;
      const { notifyBusinessEvent } = await import('@/lib/whatsapp/tenant-send');
      const res = await notifyBusinessEvent({
        businessId: biz.business_id,
        eventKey: 'merchant_dispatch_overdue',
        to: biz.phone!,
        values: { count: String(counts.stale), business_name: biz.name },
        fallbackText: `${counts.stale} paid order${counts.stale === 1 ? ' is' : 's are'} waiting more than ${settings.dispatchSlaHours} hours to be dispatched. Open Orders & delivery in Khatario.`,
      });
      if (res.via) sent++;
    } catch (err) {
      console.error('[order-dispatch-alerts]', biz.business_id, err instanceof Error ? err.message : err);
    }
  }
  return NextResponse.json({ success: true, checked: businesses.length, sent });
}

export async function GET(request: NextRequest) {
  return POST(request);
}
