import { NextRequest, NextResponse } from 'next/server';
import { getUserIdFromRequest, getBusinessIdFromRequest, requireStrictSession } from '@/lib/auth-helpers';
import { queryRows } from '@/lib/db';
import { authorize, AuthorizationError } from '@/lib/authorization';
import { RolePermissionError, createRole, requestMeta } from '@/lib/rbac-role-permissions';
import { getBusinessPlatformContext } from '@/lib/business-modules';
import {
  isSystemRoleVisibleForModules,
  sortRolesForModules,
} from '@/lib/rbac-role-catalog';

export const dynamic = 'force-dynamic';

/**
 * GET /api/settings/roles
 * List all roles for a business with their permissions
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const businessId = getBusinessIdFromRequest(request);
    const userId = getUserIdFromRequest(request); // REQUIRED for authorization

    if (!businessId) {
      return NextResponse.json(
        { error: 'business_id is required' },
        { status: 400 }
      );
    }

    if (!userId) {
      return NextResponse.json(
        { error: 'user_id is required for authorization' },
        { status: 400 }
      );
    }

    // AUTHORIZATION: Check read permission (roles are part of settings)
    try {
      await authorize(userId, 'settings', 'read');
    } catch (error) {
      if (error instanceof AuthorizationError) {
        return error.toNextResponse();
      }
      throw error;
    }

    // Get roles (active only; billing presets hidden for HR-only via catalog filter)
    const platformCtx = await getBusinessPlatformContext(businessId);
    const allRoles = await queryRows(`
      SELECT 
        id,
        business_id,
        role_name,
        role_key,
        description,
        is_system_role,
        is_active,
        created_at
      FROM user_roles
      WHERE business_id = $1 AND is_active = true
    `, [businessId]);

    const roles = sortRolesForModules(
      allRoles.filter((role) =>
        isSystemRoleVisibleForModules(role.role_key, platformCtx.enabledModules),
      ),
      platformCtx.enabledModules,
    );

    // Get permissions for each role
    for (const role of roles) {
      const permissions = await queryRows(`
        SELECT 
          rp.module_key,
          pm.module_name,
          pm.description as module_description,
          rp.can_view,
          rp.can_add,
          rp.can_modify,
          rp.can_delete,
          rp.can_share
        FROM role_permissions rp
        INNER JOIN permission_modules pm ON rp.module_key = pm.module_key
        WHERE rp.role_id = $1
        ORDER BY pm.display_order ASC
      `, [role.id]);

      role.permissions = permissions;
    }

    return NextResponse.json({ roles });
  } catch (error: any) {
    console.error('Error fetching roles:', error);
    return NextResponse.json(
      { error: 'Failed to fetch roles', details: error.message },
      { status: 500 }
    );
  }
}

/**
 * POST /api/settings/roles
 * Create a custom role in the caller's business (settings:create). Body `business_id`,
 * `created_by_user_id`, `created_by` and `user_id` are ignored; actor and business come from the session.
 */
export async function POST(request: NextRequest) {
  const session = await requireStrictSession(request);
  if (!session.ok) return session.response;
  const { userId, businessId } = session;

  let body: Record<string, unknown>;
  try {
    const parsed = await request.json();
    body = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body', code: 'INVALID_JSON' }, { status: 400 });
  }

  try {
    await authorize(userId, 'settings', 'create', { businessId });
    const { role, changes } = await createRole({
      actorId: userId,
      businessId,
      roleName: body.role_name,
      description: body.description,
      permissions: body.permissions,
      meta: requestMeta(request),
    });
    return NextResponse.json({ success: true, role, changes, message: 'Role created successfully' });
  } catch (error) {
    if (error instanceof AuthorizationError) return error.toNextResponse();
    if (error instanceof RolePermissionError) return error.toNextResponse();
    console.error('Error creating role:', error);
    return NextResponse.json({ error: 'Failed to create role' }, { status: 500 });
  }
}

