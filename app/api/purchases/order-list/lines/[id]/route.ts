import { NextRequest, NextResponse } from 'next/server';
import { authorize } from '@/lib/authorization';
import { requireAuthenticatedTenant } from '@/lib/stock-request-security';
import { loadOrderList, removeOrderListLine, updateOrderListLine } from '@/lib/order-list';
import { orderListError } from '../../shared';

export const dynamic = 'force-dynamic';

/** PATCH — { qty?, supplier_id?, rack? } for one line of the open list. */
export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  const auth = requireAuthenticatedTenant(request);
  if (auth instanceof NextResponse) return auth;
  try {
    await authorize(auth.userId, 'purchases', 'create', { businessId: auth.businessId });
    const body = await request.json().catch(() => ({}));
    await updateOrderListLine(auth.businessId, params.id, {
      qty: body.qty !== undefined ? Number(body.qty) : undefined,
      supplier_id: body.supplier_id !== undefined ? body.supplier_id : undefined,
      rack: body.rack !== undefined ? body.rack : undefined,
    });
    return NextResponse.json(await loadOrderList(auth.businessId, auth.userId));
  } catch (error) {
    return orderListError(error, 'Failed to save');
  }
}

/** DELETE — take the line off the list. */
export async function DELETE(request: NextRequest, { params }: { params: { id: string } }) {
  const auth = requireAuthenticatedTenant(request);
  if (auth instanceof NextResponse) return auth;
  try {
    await authorize(auth.userId, 'purchases', 'create', { businessId: auth.businessId });
    await removeOrderListLine(auth.businessId, params.id);
    return NextResponse.json(await loadOrderList(auth.businessId, auth.userId));
  } catch (error) {
    return orderListError(error, 'Failed to remove');
  }
}
