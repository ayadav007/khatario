import { NextRequest, NextResponse } from 'next/server';
import * as db from '@/lib/db';
import { requireAuthenticatedTenant } from '@/lib/stock-request-security';
import { authorizeOrderRole, supplyOrderErrorResponse } from '@/lib/supply-order-http';
import { actOnStandingOrder, StandingOrderError } from '@/lib/supply-standing-orders';

export const dynamic = 'force-dynamic';

/** PATCH /api/supply-orders/standing/[id] — { action: 'accept' | 'decline' | 'pause' | 'resume' | 'end' } */
export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  const auth = requireAuthenticatedTenant(request);
  if (auth instanceof NextResponse) return auth;
  const client = await db.getPool().connect();
  try {
    const body = await request.json().catch(() => ({}));
    const so = (
      await client.query(`SELECT buyer_business_id FROM supply_standing_orders WHERE id = $1`, [params.id])
    ).rows[0];
    const role = so?.buyer_business_id === auth.businessId ? 'buyer' : 'vendor';
    await authorizeOrderRole(auth.userId, auth.businessId, role, 'update');
    await client.query('BEGIN');
    const status = await actOnStandingOrder({ id: params.id, businessId: auth.businessId, action: String(body.action || '') }, client);
    await client.query('COMMIT');
    return NextResponse.json({ ok: true, status });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    if (error instanceof StandingOrderError) return NextResponse.json({ error: error.message }, { status: error.status });
    return supplyOrderErrorResponse(error, 'Failed to update the standing order');
  } finally {
    client.release();
  }
}
