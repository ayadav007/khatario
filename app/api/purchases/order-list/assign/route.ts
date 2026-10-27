import { NextRequest, NextResponse } from 'next/server';
import { authorize } from '@/lib/authorization';
import { requireAuthenticatedTenant } from '@/lib/stock-request-security';
import { assignOrderListSupplier, loadOrderList } from '@/lib/order-list';
import { orderListError } from '../shared';

export const dynamic = 'force-dynamic';

/**
 * POST /api/purchases/order-list/assign — { line_ids, supplier_id, remember }
 * One supplier for many lines; with remember (the default) it becomes their default supplier.
 */
export async function POST(request: NextRequest) {
  const auth = requireAuthenticatedTenant(request);
  if (auth instanceof NextResponse) return auth;
  try {
    await authorize(auth.userId, 'purchases', 'create', { businessId: auth.businessId });
    const body = await request.json().catch(() => ({}));
    await assignOrderListSupplier({
      businessId: auth.businessId,
      lineIds: Array.isArray(body.line_ids) ? body.line_ids.map(String) : [],
      supplierId: String(body.supplier_id || ''),
      remember: body.remember !== false,
    });
    return NextResponse.json(await loadOrderList(auth.businessId, auth.userId));
  } catch (error) {
    return orderListError(error, 'Failed to set the supplier');
  }
}
