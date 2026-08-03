import { NextRequest, NextResponse } from 'next/server';
import { query, queryOne, queryRows } from '@/lib/db';
import { authorize, AuthorizationError } from '@/lib/authorization';
import {
  RBAC_STANDARD_ACTIONS,
  buildRbacCatalogFromModules,
  type PermissionModuleRow,
} from '@/lib/rbac-permission-catalog';

export const dynamic = 'force-dynamic';

async function fetchRolePermissionFlags(
  roleId: string,
  moduleKey: string,
): Promise<Record<string, boolean>> {
  const rp = await queryOne<{
    can_view: boolean;
    can_add: boolean;
    can_modify: boolean;
    can_delete: boolean;
    can_share: boolean;
  }>(
    `SELECT can_view, can_add, can_modify, can_delete, can_share
     FROM role_permissions
     WHERE role_id = $1 AND module_key = $2`,
    [roleId, moduleKey],
  );

  const flags: Record<string, boolean> = {};
  for (const action of RBAC_STANDARD_ACTIONS) {
    flags[action.flag] = rp ? Boolean((rp as Record<string, boolean>)[action.flag]) : false;
  }
  return flags;
}

/**
 * GET /api/settings/roles/[id]/permissions
 * Get permissions for a role
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const roleId = params.id;

    const role = await queryOne<{ role_key?: string }>(
      'SELECT role_key FROM user_roles WHERE id = $1',
      [roleId]
    );

    const isPrimaryAdmin = role?.role_key === 'primary_admin';

    const modules = await queryRows<PermissionModuleRow>(
      `SELECT module_key, module_name, display_order
       FROM permission_modules
       WHERE is_active = true
       ORDER BY display_order NULLS LAST, module_name ASC`,
    );

    const catalog = buildRbacCatalogFromModules(modules);
    const allPerms: Array<{ permission_id: string; granted: boolean }> = [];

    for (const mod of modules) {
      const flags = isPrimaryAdmin
        ? Object.fromEntries(RBAC_STANDARD_ACTIONS.map((a) => [a.flag, true]))
        : await fetchRolePermissionFlags(roleId, mod.module_key);

      for (const action of RBAC_STANDARD_ACTIONS) {
        allPerms.push({
          permission_id: `${mod.module_key}_${action.key}`,
          granted: Boolean(flags[action.flag]),
        });
      }
    }

    // Include any catalog entries not covered above (defensive)
    if (allPerms.length === 0 && catalog.length > 0) {
      for (const perm of catalog) {
        allPerms.push({
          permission_id: perm.id,
          granted: isPrimaryAdmin,
        });
      }
    }

    return NextResponse.json({ permissions: allPerms });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to fetch role permissions';
    console.error('Error fetching role permissions:', error);
    return NextResponse.json(
      { error: 'Failed to fetch role permissions', details: message },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/settings/roles/[id]/permissions
 * Update permissions for a role
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const roleId = params.id;
    const body = await request.json();
    const { permissions, updated_by_user_id } = body;

    if (!permissions || !Array.isArray(permissions)) {
      return NextResponse.json(
        { error: 'permissions array is required' },
        { status: 400 }
      );
    }

    if (!updated_by_user_id) {
      return NextResponse.json(
        { error: 'updated_by_user_id is required for authorization' },
        { status: 400 }
      );
    }

    // Get role
    const role = await queryOne(
      'SELECT id, business_id, role_name, role_key, is_system_role FROM user_roles WHERE id = $1',
      [roleId]
    );

    if (!role) {
      return NextResponse.json(
        { error: 'Role not found' },
        { status: 404 }
      );
    }

    // AUTHORIZATION: Check update permission (roles are part of settings)
    try {
      await authorize(updated_by_user_id, 'settings', 'update', { 
        businessId: role.business_id,
        resourceId: roleId
      });
    } catch (error) {
      if (error instanceof AuthorizationError) {
        return error.toNextResponse();
      }
      throw error;
    }

    // Prevent modifying primary_admin permissions
    if (role.role_key === 'primary_admin') {
      return NextResponse.json(
        { error: 'Cannot modify Primary Admin permissions' },
        { status: 403 }
      );
    }

    // Update permissions
    for (const perm of permissions) {
      await query(`
        INSERT INTO role_permissions (
          role_id, module_key, can_view, can_add, can_modify, can_delete, can_share
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        ON CONFLICT (role_id, module_key)
        DO UPDATE SET
          can_view = EXCLUDED.can_view,
          can_add = EXCLUDED.can_add,
          can_modify = EXCLUDED.can_modify,
          can_delete = EXCLUDED.can_delete,
          can_share = EXCLUDED.can_share,
          updated_at = CURRENT_TIMESTAMP
      `, [
        roleId,
        perm.module_key,
        perm.can_view || false,
        perm.can_add || false,
        perm.can_modify || false,
        perm.can_delete || false,
        perm.can_share || false
      ]);
    }

    // Log activity
    if (updated_by_user_id) {
      const updater = await queryOne('SELECT name FROM users WHERE id = $1', [updated_by_user_id]);
      await query(`
        INSERT INTO user_activity_logs (
          business_id, user_id, user_name, action, module, entity_type, entity_id, details
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      `, [
        role.business_id,
        updated_by_user_id,
        updater?.name || 'Unknown',
        'update_role_permissions',
        'settings',
        'role',
        roleId,
        JSON.stringify({ role_name: role.role_name })
      ]);
    }

    return NextResponse.json({
      success: true,
      message: 'Permissions updated successfully'
    });
  } catch (error: any) {
    console.error('Error updating permissions:', error);
    return NextResponse.json(
      { error: 'Failed to update permissions', details: error.message },
      { status: 500 }
    );
  }
}

