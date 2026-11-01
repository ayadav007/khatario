import { NextRequest, NextResponse } from 'next/server';
import * as db from '@/lib/db';
import { authorize } from '@/lib/authorization';
import { requireAuthenticatedTenant } from '@/lib/stock-request-security';
import { appBaseUrl } from '@/lib/insights/format';
import { sendOrderList } from '@/lib/order-list';
import { orderListError } from '../shared';

export const dynamic = 'force-dynamic';

/**
 * POST /api/purchases/order-list/send — one order per supplier. Connected suppliers get a
 * Supplier Hub order; the rest come back with a link and message to send on WhatsApp.
 */
export async function POST(request: NextRequest) {
  const auth = requireAuthenticatedTenant(request);
  if (auth instanceof NextResponse) return auth;
  const client = await db.getPool().connect();
  try {
    await authorize(auth.userId, 'purchases', 'create', { businessId: auth.businessId });
    await client.query('BEGIN');
    const results = await sendOrderList(
      { businessId: auth.businessId, userId: auth.userId, baseUrl: appBaseUrl() || 'https://khatario.com' },
      client
    );
    await client.query('COMMIT');
    return NextResponse.json({ results });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    return orderListError(error, 'Failed to send the orders');
  } finally {
    client.release();
  }
}
