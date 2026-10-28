import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUserId, requireTenantBusinessId } from '@/lib/auth-helpers';
import { authorize, AuthorizationError } from '@/lib/authorization';

type AuthorizeAction = Parameters<typeof authorize>[2];

export type TenantPermissionResult =
  | { ok: true; businessId: string; userId: string }
  | { ok: false; response: NextResponse };

/**
 * Tenant and actor from the middleware-verified session, then an RBAC check in that tenant.
 * A client `business_id` that differs from the session is refused (403); it is never used.
 */
export async function requireTenantPermission(
  request: NextRequest,
  claimedBusinessId: unknown,
  moduleKey: string,
  action: AuthorizeAction
): Promise<TenantPermissionResult> {
  const tenant = requireTenantBusinessId(
    request,
    typeof claimedBusinessId === 'string' ? claimedBusinessId : null
  );
  if (!tenant.ok) return tenant;
  const userId = getAuthenticatedUserId(request);
  if (!userId) {
    return { ok: false, response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  }
  try {
    await authorize(userId, moduleKey, action, { businessId: tenant.businessId });
  } catch (error) {
    if (error instanceof AuthorizationError) return { ok: false, response: error.toNextResponse() };
    throw error;
  }
  return { ok: true, businessId: tenant.businessId, userId };
}
