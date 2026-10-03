import { NextRequest, NextResponse } from 'next/server';
import { queryOne } from '@/lib/db';
import { getAuthenticatedUserId, requireTenantBusinessId } from '@/lib/auth-helpers';
import { authorize, AuthorizationError } from '@/lib/authorization';
import type { HubScope } from './hub';

export type HubAuth =
  | { ok: true; scope: HubScope; userId: string }
  | { ok: false; response: NextResponse };

/**
 * Session business and user only. Admins see every branch; other staff see the branches they are
 * assigned to plus orders that have no branch yet (fresh store orders).
 */
export async function resolveHubAuth(request: NextRequest, action: 'read' | 'update'): Promise<HubAuth> {
  const tenant = requireTenantBusinessId(request);
  if (!tenant.ok) return tenant;
  const userId = getAuthenticatedUserId(request);
  if (!userId) return { ok: false, response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  try {
    await authorize(userId, 'invoices', action);
  } catch (error) {
    if (error instanceof AuthorizationError) return { ok: false, response: error.toNextResponse() };
    throw error;
  }

  const user = await queryOne<{ is_primary_admin: boolean | null }>(
    `SELECT is_primary_admin FROM users WHERE id = $1 AND business_id = $2`,
    [userId, tenant.businessId],
  );
  let admin = Boolean(user?.is_primary_admin);
  if (!admin) {
    const { checkUserPermission } = await import('@/lib/permissions');
    admin = await checkUserPermission(userId, 'settings', 'read').catch(() => false);
  }
  let branchIds: string[] | null = null;
  if (!admin) {
    const { getUserAccessibleBranchIds } = await import('@/lib/branch-access');
    branchIds = await getUserAccessibleBranchIds(userId);
  }
  return { ok: true, scope: { businessId: tenant.businessId, branchIds }, userId };
}
