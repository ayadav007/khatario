import { NextRequest, NextResponse } from 'next/server';
import { requireTenantBusinessId } from '@/lib/auth-helpers';
import { loadCheckoutStatus } from '@/lib/subscription/checkout-status';

export const dynamic = 'force-dynamic';

/**
 * GET /api/subscriptions/checkout/status?tx=<payment id>
 * Where one checkout payment stands: pending, completed, failed or expired (refunded when it was paid and
 * then refunded), with the plan name and, when a stale upgrade credit shortened the period, the days
 * bought. The payment id is in the return URL and is not a secret, so the business always comes from the
 * signed-in session: a payment of another business answers 404, exactly like one that does not exist.
 */
export async function GET(request: NextRequest) {
  const tenant = requireTenantBusinessId(request);
  if (!tenant.ok) return tenant.response;
  const tx = (request.nextUrl.searchParams.get('tx') ?? '').trim();
  try {
    const result = tx ? await loadCheckoutStatus(tx, tenant.businessId) : null;
    if (!result) return NextResponse.json({ error: 'Payment not found' }, { status: 404 });
    return NextResponse.json(result);
  } catch (error) {
    console.error('Error loading checkout status:', error);
    return NextResponse.json({ error: 'Failed to load payment status' }, { status: 500 });
  }
}
