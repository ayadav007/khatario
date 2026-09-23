import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { parseShiprocketWebhook } from '@/lib/store/delivery/webhooks';

export const dynamic = 'force-dynamic';

/** Shiprocket posts tracking updates here (configure on staging.khatario.com). */
export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const parsed = parseShiprocketWebhook(body);

  if (parsed.status && (parsed.awb || parsed.orderRef)) {
    await query(
      `UPDATE store_orders
       SET status = $1,
           awb = COALESCE(NULLIF($2, ''), awb),
           tracking_url = COALESCE(tracking_url, $3),
           updated_at = CURRENT_TIMESTAMP
       WHERE ($2 <> '' AND awb = $2)
          OR ($4 <> '' AND (order_number = $4 OR shipment_id = $4))`,
      [
        parsed.status,
        parsed.awb,
        parsed.awb ? `https://shiprocket.co/tracking/${parsed.awb}` : null,
        parsed.orderRef,
      ],
    );
  }

  return NextResponse.json({ ok: true });
}
