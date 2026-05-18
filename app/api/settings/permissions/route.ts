import { NextRequest, NextResponse } from 'next/server';
import { getUserPermissions } from '@/lib/permissions';
import { queryRows, queryOne } from '@/lib/db';
import { getUserIdFromRequest, requirePortalSession } from '@/lib/auth-helpers';

/**
 * GET /api/settings/permissions
 * Get permissions for a user in the format expected by the frontend
 * Returns: { permissions: { module_key: { can_view, can_add, can_modify, can_delete, can_share } } }
 */
export async function GET(request: NextRequest) {
  try {
    const gate = await requirePortalSession(request);
    if (gate) return gate;

    const userId = getUserIdFromRequest(request);

    if (!userId) {
      return NextResponse.json(
        { error: 'Not authenticated' },
        { status: 401 }
      );
    }

    // Get user's role
    const user = await queryOne<{ role_id?: string; is_primary_admin?: boolean }>(
      'SELECT role_id, is_primary_admin FROM users WHERE id = $1',
      [userId]
    );

    if (!user) {
      return NextResponse.json({ permissions: {} });
    }

    // PRIMARY ADMIN BYPASS: If user is primary admin, return all permissions for all modules
    let isPrimaryAdmin = user.is_primary_admin || false;
    if (user.role_id) {
      const role = await queryOne<{ role_key?: string }>(
        'SELECT role_key FROM user_roles WHERE id = $1',
        [user.role_id]
      );
      if (role?.role_key === 'primary_admin') {
        isPrimaryAdmin = true;
      }
    }

    // Format permissions for frontend
    const permissions: Record<string, {
      can_view: boolean;
      can_add: boolean;
      can_modify: boolean;
      can_delete: boolean;
      can_share: boolean;
    }> = {};

    if (isPrimaryAdmin) {
      // Return all permissions (all true) for all modules
      const allModules = await queryRows<{ module_key: string }>(
        'SELECT module_key FROM permission_modules WHERE is_active = true'
      );
      for (const module of allModules) {
        permissions[module.module_key] = {
          can_view: true,
          can_add: true,
          can_modify: true,
          can_delete: true,
          can_share: true,
        };
      }
    } else if (user.role_id) {
      // Get role permissions from old system (module_key + boolean flags)
      const rolePerms = await queryRows<{
        module_key: string;
        can_view: boolean;
        can_add: boolean;
        can_modify: boolean;
        can_delete: boolean;
        can_share: boolean;
      }>(
        `SELECT module_key, can_view, can_add, can_modify, can_delete, can_share
         FROM role_permissions
         WHERE role_id = $1
         ORDER BY module_key`,
        [user.role_id]
      );

      for (const perm of rolePerms) {
        permissions[perm.module_key] = {
          can_view: perm.can_view || false,
          can_add: perm.can_add || false,
          can_modify: perm.can_modify || false,
          can_delete: perm.can_delete || false,
          can_share: perm.can_share || false,
        };
      }
    }

    return NextResponse.json({ permissions, isPrimaryAdmin });
  } catch (error: any) {
    console.error('Error fetching permissions:', error);
    return NextResponse.json(
      { error: 'Failed to fetch permissions', details: error.message },
      { status: 500 }
    );
  }
}
