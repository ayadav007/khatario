import { NextRequest, NextResponse } from 'next/server';
import { queryRows } from '@/lib/db';
import { assertCronAuthorized } from '@/lib/cron-auth';
import { sanitizeOrderUpdateSettings } from '@/lib/fulfilment/update-settings';
import { orderTrackingUrl } from '@/lib/customer-surface/urls';

export const dynamic = 'force-dynamic';

/**
 * GET/POST /api/cron/stuck-parcels — once per parcel, tells the buyer when a shipped parcel has not
 * moved for the shop's "delay notice" days (Orders & delivery > Buyer updates; 0 = off).
 * The parcel is claimed (stuck_notified_at) before sending, so a retry never messages twice.
 */
export async function POST(request: NextRequest) {
  const denied = assertCronAuthorized(request);
  if (denied) return denied;

  const businesses = await queryRows<{ business_id: string; s: unknown }>(
    `SELECT bs.business_id, bs.order_update_settings AS s
       FROM business_settings bs
       JOIN businesses b ON b.id = bs.business_id
      WHERE b.platform_suspended_at IS NULL
        AND COALESCE((bs.order_update_settings->>'stuckNoticeDays')::int, 3) > 0`,
  );

  let sent = 0;
  let claimed = 0;
  for (const biz of businesses) {
    const days = sanitizeOrderUpdateSettings(biz.s).stuckNoticeDays;
    if (days <= 0) continue;
    try {
      const rows = await queryRows<{
        id: string;
        buyer_name: string | null;
        buyer_phone: string | null;
        partner_name: string | null;
        public_token: string;
        order_number: string | null;
        business_name: string;
      }>(
        `UPDATE order_fulfilments f
            SET stuck_notified_at = NOW()
           FROM businesses b
          WHERE f.business_id = $1 AND b.id = f.business_id
            AND f.status IN ('shipped', 'out_for_delivery')
            AND f.stuck_notified_at IS NULL
            AND f.status_changed_at < NOW() - make_interval(days => $2::int)
            AND f.buyer_phone IS NOT NULL
          RETURNING f.id, f.buyer_name, f.buyer_phone, f.partner_name, f.public_token, b.name AS business_name,
                    (SELECT COALESCE(so.order_number, s.order_number, i.invoice_number)
                       FROM order_fulfilments x
                       LEFT JOIN store_orders so ON so.id = x.store_order_id
                       LEFT JOIN sales_orders s ON s.id = x.sales_order_id
                       LEFT JOIN invoices i ON i.id = x.invoice_id
                      WHERE x.id = f.id) AS order_number`,
        [biz.business_id, days],
      );
      claimed += rows.length;
      if (rows.length === 0) continue;
      const { notifyBusinessEvent } = await import('@/lib/whatsapp/tenant-send');
      for (const r of rows) {
        const link = orderTrackingUrl(r.public_token);
        const first = (r.buyer_name ?? '').trim().split(/\s+/)[0] || 'there';
        const courier = r.partner_name || 'our delivery partner';
        const res = await notifyBusinessEvent({
          businessId: biz.business_id,
          eventKey: 'order_delayed',
          to: r.buyer_phone!,
          values: { customer_name: first, order_number: r.order_number ?? '', courier, order_link: link, business_name: r.business_name },
          fallbackText: `Hi ${first}, your order ${r.order_number ?? ''} from ${r.business_name} is taking a little longer than usual. We are following up with ${courier}. Track it: ${link}`,
        }).catch(() => ({ via: null }));
        if (res.via) sent++;
        await queryRows(
          `INSERT INTO order_fulfilment_events (fulfilment_id, business_id, status, note, actor_type)
           SELECT id, business_id, status, $2, 'system' FROM order_fulfilments WHERE id = $1`,
          [r.id, res.via ? 'Buyer told the parcel is delayed' : 'Parcel delayed (buyer message not sent)'],
        );
      }
    } catch (err) {
      console.error('[stuck-parcels]', biz.business_id, err instanceof Error ? err.message : err);
    }
  }
  return NextResponse.json({ success: true, businesses: businesses.length, parcels: claimed, sent });
}

export async function GET(request: NextRequest) {
  return POST(request);
}
