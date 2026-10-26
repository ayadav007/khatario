import { NextRequest, NextResponse } from 'next/server';
import { authorize, AuthorizationError } from '@/lib/authorization';
import { getAuthenticatedUserId, getSessionScopedBusinessId } from '@/lib/auth-helpers';
import { StockCountError } from '@/lib/stock-counts/counts';
import { stockErrorBody } from '@/lib/inventory/godown-stock';

/**
 * Reading a count needs inventory read access; counting, submitting and posting need the
 * quantity-adjustment permission, since posting adjusts stock.
 */
export async function authorizeStockCount(
  request: NextRequest,
  action: 'read' | 'adjust_quantity' | 'adjust_value',
  context: { warehouseId?: string | null; adjustmentDate?: string | null; stockCountId?: string | null } = {}
): Promise<{ ok: true; userId: string; businessId: string } | { ok: false; response: NextResponse }> {
  const userId = getAuthenticatedUserId(request);
  const businessId = getSessionScopedBusinessId(request);
  if (!userId || !businessId) {
    return { ok: false, response: NextResponse.json({ error: 'Authentication required', code: 'UNAUTHENTICATED' }, { status: 401 }) };
  }
  try {
    await authorize(userId, 'inventory_adjustment', action, {
      businessId,
      warehouseId: context.warehouseId || undefined,
      stockCountId: context.stockCountId || undefined,
      resource: {
        business_id: businessId,
        warehouse_id: context.warehouseId || null,
        adjustment_date: context.adjustmentDate || undefined,
      },
    } as any);
  } catch (error) {
    if (error instanceof AuthorizationError) return { ok: false, response: error.toNextResponse() };
    throw error;
  }
  return { ok: true, userId, businessId };
}

export function stockCountErrorResponse(error: any, fallback: string): NextResponse {
  if (error instanceof StockCountError) {
    return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
  }
  const refused = stockErrorBody(error);
  if (refused) return NextResponse.json(refused.body, { status: refused.status });
  console.error(fallback, error);
  return NextResponse.json({ error: fallback, details: error?.message }, { status: 500 });
}
