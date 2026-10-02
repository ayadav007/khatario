import { NextRequest, NextResponse } from 'next/server';
import { requireStrictSession } from '@/lib/auth-helpers';
import { authorize, AuthorizationError } from '@/lib/authorization';
import { RBAC_STANDARD_ACTIONS } from '@/lib/rbac-permission-catalog';
import {
  RolePermissionError,
  parsePermissionIdPayload,
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
 * GET /api/roles/[id]/permissions
 * Permission flags for a role in the caller's business (settings:read).
 */
export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  const session = await requireStrictSession(request);
  if (!session.ok) return session.response;
  const { userId, businessId } = session;

  try {
    await authorize(userId, 'settings', 'read', { businessId, resourceId: params.id });
    const data = await readRolePermissions(params.id, businessId);
    if (!data) return NextResponse.json({ error: 'Role not found', code: 'ROLE_NOT_FOUND' }, { status: 404 });

    const permissions = [];
    for (const mod of data.modules) {
      const flags = data.flags.get(mod.module_key);
      for (const action of RBAC_STANDARD_ACTIONS) {
        const id = `${mod.module_key}_${action.key}`;
        permissions.push({
          id,
          role_id: data.role.id,
          permission_id: id,
          granted: flags?.[action.flag] === true,
          created_at: null,
          permission_key: action.key,
          permission_name: action.name,
          module_key: mod.module_key,
          module_name: mod.module_name,
        });
      }
    }
    return NextResponse.json({ permissions });
  } catch (error) {
    return errorResponse(error, 'Failed to fetch role permissions');
  }
}

/**
 * POST /api/roles/[id]/permissions
 * Replaces a role's permissions with `{ permissions: [{ permission_id, granted }] }` (settings:update).
 */
export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
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
      mode: 'replace',
      parse: (active) => parsePermissionIdPayload(permissions, active),
      meta: requestMeta(request),
    });
    return NextResponse.json({ success: true, message: 'Permissions updated', changes });
  } catch (error) {
    return errorResponse(error, 'Failed to update role permissions');
  }
}
