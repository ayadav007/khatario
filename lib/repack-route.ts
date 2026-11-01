import { NextRequest, NextResponse } from 'next/server';
import { authorize, AuthorizationError } from '@/lib/authorization';
import { getUserIdFromRequest, requireTenantBusinessId } from '@/lib/auth-helpers';
import { assertFeatureAccess, FeatureAccessDeniedError } from '@/lib/subscription/feature-access';
import { RepackError } from '@/lib/repack-service';

export type RepackContext = { businessId: string; userId: string };

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Session tenant + user, the adjustments feature, and items read/create permission. */
export async function repackContext(
  request: NextRequest,
  action: 'read' | 'create'
): Promise<RepackContext | NextResponse> {
  const tenant = requireTenantBusinessId(request, new URL(request.url).searchParams.get('business_id'));
  if (!tenant.ok) return tenant.response;
  const userId = getUserIdFromRequest(request);
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    await assertFeatureAccess(tenant.businessId, 'purchase_inventory_adjustments');
    await authorize(userId, 'items', action, { businessId: tenant.businessId });
  } catch (error) {
    if (error instanceof FeatureAccessDeniedError) return error.toNextResponse();
    if (error instanceof AuthorizationError) return error.toNextResponse();
    throw error;
  }
  return { businessId: tenant.businessId, userId };
}

export function repackErrorResponse(error: unknown, fallback: string): NextResponse {
  if (error instanceof RepackError) {
    return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
  }
  console.error(`[repack] ${fallback}:`, error);
  return NextResponse.json({ error: fallback }, { status: 500 });
}
