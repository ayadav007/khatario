import { NextRequest, NextResponse } from 'next/server';
import { requireStrictSession } from '@/lib/auth-helpers';
import { authorize, AuthorizationError } from '@/lib/authorization';
import { RBAC_STANDARD_ACTIONS } from '@/lib/rbac-permission-catalog';
import {
  PRIMARY_ADMIN_ROLE_KEY,
  RolePermissionError,
  parseModuleFlagsPayload,
  readRolePermissions,
  requestMeta,
  updateRolePermissions,
} from '@/lib/rbac-role-permissions';

export const dynamic = 'force-dynamic';

function errorResponse(error: unknown, fallback: string): NextResponse {
  if (error instanceof AuthorizationError) return error.toNextResponse();
  if (error instanceof RolePermissionError) return error.toNextResponse();
  console.error(fallback, error);
  return NextResponse.json({ error: fallback }, { status: 500 });
}

/**
 * GET /api/settings/roles/[id]/permissions
 * Get permissions for a role in the caller's business (settings:read).
 */
export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  const session = await requireStrictSession(request);
  if (!session.ok) return session.response;
  const { userId, businessId } = session;

  try {
    await authorize(userId, 'settings', 'read', { businessId, resourceId: params.id });
    const data = await readRolePermissions(params.id, businessId);
    if (!data) return NextResponse.json({ error: 'Role not found', code: 'ROLE_NOT_FOUND' }, { status: 404 });

    const isPrimaryAdminRole = data.role.role_key === PRIMARY_ADMIN_ROLE_KEY;
    const permissions: Array<{ permission_id: string; granted: boolean }> = [];
    for (const mod of data.modules) {
      const flags = data.flags.get(mod.module_key);
      for (const action of RBAC_STANDARD_ACTIONS) {
        permissions.push({
          permission_id: `${mod.module_key}_${action.key}`,
          granted: isPrimaryAdminRole || flags?.[action.flag] === true,
        });
      }
    }
    return NextResponse.json({ permissions });
  } catch (error) {
    return errorResponse(error, 'Failed to fetch role permissions');
  }
}

/**
 * PATCH /api/settings/roles/[id]/permissions
 * Updates the listed modules with `{ permissions: [{ module_key, can_view, ... }] }` (settings:update).
 * The actor is the session user; any `updated_by_user_id` in the body is ignored.
 */
export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  const session = await requireStrictSession(request);
  if (!session.ok) return session.response;
  const { userId, businessId } = session;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body', code: 'INVALID_JSON' }, { status: 400 });
  }
  const permissions = (body as { permissions?: unknown } | null)?.permissions;

  try {
    await authorize(userId, 'settings', 'update', { businessId, resourceId: params.id });
    const { changes } = await updateRolePermissions({
      actorId: userId,
      businessId,
      roleId: params.id,
      mode: 'merge',
      parse: (active) => parseModuleFlagsPayload(permissions, active),
      meta: requestMeta(request),
    });
    return NextResponse.json({ success: true, message: 'Permissions updated successfully', changes });
  } catch (error) {
    return errorResponse(error, 'Failed to update permissions');
  }
}
