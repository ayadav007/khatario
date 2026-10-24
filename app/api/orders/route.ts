import { NextRequest, NextResponse } from 'next/server';
import { listOrderHub, loadDispatchSlaHours, orderHubNeedsCounts } from '@/lib/fulfilment/hub';
import { resolveHubAuth } from '@/lib/fulfilment/hub-scope';

export const dynamic = 'force-dynamic';

/**
 * GET /api/orders — every sale (store, WhatsApp, counter, manual, sales order) with its payment
 * and delivery status. Filters: channel, delivery_status (or "untracked"), needs, q, page, limit.
 */
export async function GET(request: NextRequest) {
  const auth = await resolveHubAuth(request, 'read');
  if (!auth.ok) return auth.response;
  const sp = new URL(request.url).searchParams;
  const slaHours = await loadDispatchSlaHours(auth.scope.businessId);
  const page = Math.max(1, parseInt(sp.get('page') ?? '1', 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(sp.get('limit') ?? '25', 10) || 25));

  const [list, needs] = await Promise.all([
    listOrderHub(auth.scope, {
      channel: sp.get('channel'),
      deliveryStatus: sp.get('delivery_status'),
      needs: sp.get('needs'),
      q: sp.get('q'),
      page,
      limit,
      slaHours,
    }),
    sp.get('counts') === '0' ? Promise.resolve(null) : orderHubNeedsCounts(auth.scope, slaHours),
  ]);

  return NextResponse.json({
    orders: list.rows,
    total: list.total,
    page,
    limit,
    needs,
    sla_hours: slaHours,
  });
}
