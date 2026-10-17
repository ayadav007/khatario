import { NextRequest, NextResponse } from 'next/server';
import { requireAuthenticatedTenant } from '@/lib/stock-request-security';
import { buildSuggestedOrders } from '@/lib/supply-orders';
import { authorizeOrderRole, supplyOrderErrorResponse } from '@/lib/supply-order-http';

export const dynamic = 'force-dynamic';

/**
 * POST /api/supply-orders/suggest
 * For the supplier: build or top up suggested drafts now from connected buyers' low stock
 * (the daily job does the same for everyone).
 */
export async function POST(request: NextRequest) {
  const auth = requireAuthenticatedTenant(request);
  if (auth instanceof NextResponse) return auth;
  try {
    await authorizeOrderRole(auth.userId, auth.businessId, 'vendor', 'create');
    return NextResponse.json(await buildSuggestedOrders({ vendorBusinessId: auth.businessId }));
  } catch (error) {
    return supplyOrderErrorResponse(error, 'Failed to build suggestions');
  }
}
