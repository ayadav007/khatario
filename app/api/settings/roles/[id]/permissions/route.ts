import { NextRequest, NextResponse } from 'next/server';
import { query, queryOne, queryRows } from '@/lib/db';
import { authorize, AuthorizationError } from '@/lib/authorization';

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

    // Check if this is Primary Admin role
    const role = await queryOne<{ role_key?: string }>(
      'SELECT role_key FROM user_roles WHERE id = $1',
      [roleId]
    );

    const isPrimaryAdmin = role?.role_key === 'primary_admin';

    // Get all modules and actions
    const modules = await queryRows<{ module_key: string }>(
      'SELECT module_key FROM permission_modules WHERE is_active = true ORDER BY display_order'
    );

    const allPerms: any[] = [];
    const actions = [
      { key: 'read', name: 'Read', flag: 'can_view' },
      { key: 'create', name: 'Create', flag: 'can_add' },
      { key: 'update', name: 'Update', flag: 'can_modify' },
      { key: 'delete', name: 'Delete', flag: 'can_delete' },
      { key: 'export', name: 'Export', flag: 'can_share' },
    ];

    // If Primary Admin, return all permissions as granted (true) for ALL modules
    if (isPrimaryAdmin) {
      // Get all modules to ensure we include all of them
      const allActiveModules = await queryRows<{ module_key: string }>(
        'SELECT module_key FROM permission_modules WHERE is_active = true ORDER BY display_order'
      );
      
      for (const module of allActiveModules) {
        for (const action of actions) {
          allPerms.push({
            id: `${module.module_key}_${action.key}`,
            module_key: module.module_key,
            permission_key: action.key,
            permission_name: action.name,
            granted: true, // Primary Admin has all permissions
          });
        }
      }
    } else {
      // For other roles, check database permissions
      try {
        // Try NEW system first (if permissions table exists)
        const rolePerms = await queryRows<{
          id: string;
          module_key: string;
          permission_key: string;
          permission_name: string;
          granted: boolean;
        }>(
          `SELECT 
            p.id,
            pm.module_key,
            p.permission_key,
            p.permission_name,
            CASE 
              WHEN p.permission_key = 'read' THEN COALESCE(rp.can_view, false)
              WHEN p.permission_key = 'create' THEN COALESCE(rp.can_add, false)
              WHEN p.permission_key = 'update' THEN COALESCE(rp.can_modify, false)
              WHEN p.permission_key = 'delete' THEN COALESCE(rp.can_delete, false)
              WHEN p.permission_key = 'export' THEN COALESCE(rp.can_share, false)
              ELSE false
            END as granted
          FROM permissions p
          INNER JOIN permission_modules pm ON p.module_id = pm.id
          LEFT JOIN role_permissions rp ON rp.module_key = pm.module_key AND rp.role_id = $1
          WHERE p.is_active = true
          ORDER BY pm.display_order, p.permission_name`,
          [roleId]
        );

        if (rolePerms.length > 0) {
          // NEW system found, use it
          allPerms.push(...rolePerms);
        } else {
          throw new Error('No permissions found in new system');
        }
      } catch (error) {
        // Fallback to OLD system if permissions table doesn't exist
        for (const module of modules) {
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
            [roleId, module.module_key]
          );

          for (const action of actions) {
            allPerms.push({
              id: `${module.module_key}_${action.key}`,
              module_key: module.module_key,
              permission_key: action.key,
              permission_name: action.name,
              granted: rp ? (rp as any)[action.flag] || false : false,
            });
          }
        }
      }
    }

    // Format for frontend: Array of { permission_id, granted }
    const permissions = allPerms.map(perm => ({
      permission_id: perm.id || `${perm.module_key}_${perm.permission_key}`,
      granted: perm.granted || false,
    }));

    return NextResponse.json({ permissions });
  } catch (error: any) {
    console.error('Error fetching role permissions:', error);
    return NextResponse.json(
      { error: 'Failed to fetch role permissions', details: error.message },
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

