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
 * `action` may list several actions: any one of them is enough (e.g. a read that `update` also allows,
 * since a role can store update without view). The refusal is the first action's.
 */
export async function requireTenantPermission(
  request: NextRequest,
  claimedBusinessId: unknown,
  moduleKey: string,
  action: AuthorizeAction | readonly AuthorizeAction[]
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
  const actions: readonly AuthorizeAction[] = Array.isArray(action) ? action : [action as AuthorizeAction];
  let refused: AuthorizationError | null = null;
  for (const a of actions) {
    try {
      await authorize(userId, moduleKey, a, { businessId: tenant.businessId });
      return { ok: true, businessId: tenant.businessId, userId };
    } catch (error) {
      if (!(error instanceof AuthorizationError)) throw error;
      refused ??= error;
    }
  }
  if (refused) return { ok: false, response: refused.toNextResponse() };
  return { ok: false, response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) };
}
