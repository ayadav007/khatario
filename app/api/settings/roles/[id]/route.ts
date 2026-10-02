import { NextRequest, NextResponse } from 'next/server';
import { requireStrictSession } from '@/lib/auth-helpers';
import { authorize, AuthorizationError } from '@/lib/authorization';
import { RolePermissionError, deactivateRole, requestMeta } from '@/lib/rbac-role-permissions';

export const dynamic = 'force-dynamic';

/**
 * DELETE /api/settings/roles/[id]
 * Deactivate a custom role in the caller's business (settings:delete). Built-in roles and roles
 * with active users are refused.
 */
export async function DELETE(request: NextRequest, { params }: { params: { id: string } }) {
  const session = await requireStrictSession(request);
  if (!session.ok) return session.response;
  const { userId, businessId } = session;

  try {
    await authorize(userId, 'settings', 'delete', { businessId, resourceId: params.id });
    const { role } = await deactivateRole({
      actorId: userId,
      businessId,
      roleId: params.id,
      meta: requestMeta(request),
    });
    return NextResponse.json({ success: true, role, message: 'Role deactivated' });
  } catch (error) {
    if (error instanceof AuthorizationError) return error.toNextResponse();
    if (error instanceof RolePermissionError) return error.toNextResponse();
    console.error('Error deactivating role:', error);
    return NextResponse.json({ error: 'Failed to deactivate role' }, { status: 500 });
  }
}
