import { NextRequest, NextResponse } from 'next/server';
import { authorize, AuthorizationError } from '@/lib/authorization';
import { requireAuthenticatedTenant } from '@/lib/stock-request-security';
import { listIncomingBills } from '@/lib/supplier-bills';

export const dynamic = 'force-dynamic';

/**
 * GET /api/purchases/incoming-bills?status=pending|received|all
 * Bills from connected suppliers addressed to the signed-in business. Only bills dated on or
 * after the link was approved (or raised against one of its requests) are listed, so bills it
 * already typed in by hand before connecting do not show up again. A bill whose number matches
 * a purchase already entered for that supplier is flagged as a possible duplicate.
 */
export async function GET(request: NextRequest) {
  const auth = requireAuthenticatedTenant(request);
  if (auth instanceof NextResponse) return auth;
  try {
    await authorize(auth.userId, 'purchases', 'read', { businessId: auth.businessId });
    const status = new URL(request.url).searchParams.get('status') || 'pending';
    const bills = await listIncomingBills(auth.businessId, status === 'received' || status === 'all' ? status : 'pending');
    return NextResponse.json({ bills });
  } catch (error) {
    if (error instanceof AuthorizationError) return error.toNextResponse();
    console.error('incoming-bills GET', error);
    return NextResponse.json({ error: 'Failed to load incoming bills' }, { status: 500 });
  }
}
