import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUserId, getSessionScopedBusinessId } from '@/lib/auth-helpers';
import { assertReportAccess, FeatureAccessDeniedError } from '@/lib/subscription/feature-access';
import { authorize, AuthorizationError } from '@/lib/authorization';

/** Stock-location reports read under the inventory report permission. */
export async function authorizeStockReport(
  request: NextRequest,
  warehouseId?: string | null
): Promise<{ ok: true; userId: string; businessId: string } | { ok: false; response: NextResponse }> {
  const userId = getAuthenticatedUserId(request);
  const businessId = getSessionScopedBusinessId(request);
  if (!userId || !businessId) {
    return { ok: false, response: NextResponse.json({ error: 'Authentication required', code: 'UNAUTHENTICATED' }, { status: 401 }) };
  }
  try {
    await assertReportAccess(businessId, 'basic');
    await authorize(userId, 'report.inventory', 'read', {
      businessId,
      warehouseId: warehouseId || undefined,
      resource: { business_id: businessId, warehouse_id: warehouseId || null },
    });
  } catch (error) {
    if (error instanceof FeatureAccessDeniedError) return { ok: false, response: error.toNextResponse() };
    if (error instanceof AuthorizationError) return { ok: false, response: error.toNextResponse() };
    throw error;
  }
  return { ok: true, userId, businessId };
}
