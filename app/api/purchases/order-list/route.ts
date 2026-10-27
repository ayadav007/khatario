import { NextRequest, NextResponse } from 'next/server';
import { authorize } from '@/lib/authorization';
import { requireAuthenticatedTenant } from '@/lib/stock-request-security';
import { addToOrderList, loadOrderList } from '@/lib/order-list';
import { orderListError } from './shared';

export const dynamic = 'force-dynamic';

/** GET /api/purchases/order-list — the open list (made when needed) and items running low. */
export async function GET(request: NextRequest) {
  const auth = requireAuthenticatedTenant(request);
  if (auth instanceof NextResponse) return auth;
  try {
    await authorize(auth.userId, 'purchases', 'read', { businessId: auth.businessId });
    return NextResponse.json(await loadOrderList(auth.businessId, auth.userId));
  } catch (error) {
    return orderListError(error, 'Failed to load the order list');
  }
}

/** POST — { item_id, qty }: add an item, or set its quantity if it is already on the list. */
export async function POST(request: NextRequest) {
  const auth = requireAuthenticatedTenant(request);
  if (auth instanceof NextResponse) return auth;
  try {
    await authorize(auth.userId, 'purchases', 'create', { businessId: auth.businessId });
    const body = await request.json().catch(() => ({}));
    await addToOrderList({ businessId: auth.businessId, userId: auth.userId, itemId: String(body.item_id || ''), qty: Number(body.qty) });
    return NextResponse.json(await loadOrderList(auth.businessId, auth.userId));
  } catch (error) {
    return orderListError(error, 'Failed to add the item');
  }
}
