import { NextRequest, NextResponse } from 'next/server';
import { requireAuthenticatedTenant } from '@/lib/stock-request-security';
import { invoiceDraftForOrder } from '@/lib/supply-orders';
import { authorizeOrderRole, supplyOrderErrorResponse } from '@/lib/supply-order-http';

export const dynamic = 'force-dynamic';

/**
 * GET /api/supply-orders/[id]/invoice-draft
 * For the supplier: the customer and lines to pre-fill a sales invoice from a confirmed order.
 * Nothing is saved; the invoice links back to the order when it is created with supply_order_id.
 */
export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  const auth = requireAuthenticatedTenant(request);
  if (auth instanceof NextResponse) return auth;
  try {
    await authorizeOrderRole(auth.userId, auth.businessId, 'vendor', 'create');
    return NextResponse.json(await invoiceDraftForOrder(params.id, auth.businessId));
  } catch (error) {
    return supplyOrderErrorResponse(error, 'Failed to prepare the bill');
  }
}
