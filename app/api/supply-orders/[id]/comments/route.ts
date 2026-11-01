import { NextRequest, NextResponse } from 'next/server';
import { requireAuthenticatedTenant } from '@/lib/stock-request-security';
import { addOrderComment, listOrderComments, loadOrderForParty } from '@/lib/supply-orders';
import { authorizeOrderRole, supplyOrderErrorResponse } from '@/lib/supply-order-http';

export const dynamic = 'force-dynamic';

/** GET /api/supply-orders/[id]/comments — the thread on an order, for either of its businesses. */
export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  const auth = requireAuthenticatedTenant(request);
  if (auth instanceof NextResponse) return auth;
  try {
    const { role } = await loadOrderForParty(params.id, auth.businessId);
    await authorizeOrderRole(auth.userId, auth.businessId, role, 'read');
    return NextResponse.json({ comments: await listOrderComments(params.id, auth.businessId) });
  } catch (error) {
    return supplyOrderErrorResponse(error, 'Failed to load messages');
  }
}

/** POST /api/supply-orders/[id]/comments — { body }; the other business is told. */
export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const auth = requireAuthenticatedTenant(request);
  if (auth instanceof NextResponse) return auth;
  try {
    const body = await request.json().catch(() => ({}));
    const { role } = await loadOrderForParty(params.id, auth.businessId);
    // Writing on the order is a write: update on purchases (buyer) or invoices (supplier).
    await authorizeOrderRole(auth.userId, auth.businessId, role, 'update');
    const comment = await addOrderComment({
      orderId: params.id,
      businessId: auth.businessId,
      userId: auth.userId,
      body: typeof body.body === 'string' ? body.body : '',
    });
    return NextResponse.json({ comment }, { status: 201 });
  } catch (error) {
    return supplyOrderErrorResponse(error, 'Failed to send the message');
  }
}
