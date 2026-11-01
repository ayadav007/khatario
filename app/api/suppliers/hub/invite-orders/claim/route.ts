import { NextRequest, NextResponse } from 'next/server';
import * as db from '@/lib/db';
import { authorize, AuthorizationError } from '@/lib/authorization';
import { requireAuthenticatedTenant } from '@/lib/stock-request-security';
import { claimInvite, InviteOrderError } from '@/lib/supplier-invites';

export const dynamic = 'force-dynamic';

/**
 * POST /api/suppliers/hub/invite-orders/claim — { token }
 * The signed-in business connects with the buyer who sent it an order link.
 */
export async function POST(request: NextRequest) {
  const auth = requireAuthenticatedTenant(request);
  if (auth instanceof NextResponse) return auth;
  const client = await db.getPool().connect();
  try {
    await authorize(auth.userId, 'invoices', 'create', { businessId: auth.businessId });
    const body = await request.json().catch(() => ({}));
    await client.query('BEGIN');
    const result = await claimInvite(String(body.token || ''), auth.businessId, client);
    await client.query('COMMIT');
    return NextResponse.json({ ok: true, buyer_business_id: result.buyerBusinessId });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    if (error instanceof InviteOrderError) return NextResponse.json({ error: error.message }, { status: error.status });
    if (error instanceof AuthorizationError) return error.toNextResponse();
    console.error('claim invite order', error);
    return NextResponse.json({ error: 'Failed to connect' }, { status: 500 });
  } finally {
    client.release();
  }
}
