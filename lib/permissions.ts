/**
 * Permission Checking Utilities
 * Check if a user/role has specific permissions
 */

import { queryOne, queryRows } from '@/lib/db';

export interface PermissionCheck {
  hasPermission: boolean;
  reason?: string;
}

/**
 * Check if a role has a specific permission.
 * Uses module_key + boolean flags (can_view, can_add, can_modify, can_delete, can_share).
 */
export async function checkRolePermission(
  roleId: string,
  moduleKey: string,
  permissionKey: string
): Promise<boolean> {
  try {
    const permissionMap: Record<string, string> = {
      'read': 'can_view',
      'create': 'can_add',
      'update': 'can_modify',
      'delete': 'can_delete',
      'export': 'can_share',
      'view': 'can_view',
      'add': 'can_add',
      'modify': 'can_modify',
      'share': 'can_share',
    };

    const column = permissionMap[permissionKey];
    if (!column) {
      console.warn(`Unknown permission key: ${permissionKey}`);
      return false;
    }

    const result = await queryOne<{ has_permission: boolean }>(
      `SELECT ${column} as has_permission
       FROM role_permissions
       WHERE role_id = $1
       AND module_key = $2`,
      [roleId, moduleKey]
    );

    return !!result?.has_permission;
  } catch (error) {
    console.error('Error checking role permission:', error);
    return false;
  }
}

/**
 * Check if a user has a specific permission.
 * Primary admin must have permissions assigned via role_permissions table.
 */
export async function checkUserPermission(
  userId: string,
  moduleKey: string,
  permissionKey: string
): Promise<boolean> {
  try {
    const user = await queryOne<{ role_id?: string; business_id?: string; is_primary_admin?: boolean }>(
      'SELECT role_id, business_id, is_primary_admin FROM users WHERE id = $1',
      [userId]
    );

    if (!user) {
      return false;
    }

    let roleId = user.role_id;
    if (!roleId && user.is_primary_admin && user.business_id) {
      const primaryAdminRole = await queryOne<{ id: string }>(
        'SELECT id FROM user_roles WHERE business_id = $1 AND role_key = $2',
        [user.business_id, 'primary_admin']
      );
      if (primaryAdminRole) {
        roleId = primaryAdminRole.id;
      }
    }

    if (!roleId) {
      return false;
    }

    return await checkRolePermission(roleId, moduleKey, permissionKey);
  } catch (error) {
    console.error('Error checking user permission:', error);
    return false;
  }
}

/**
 * Get all permissions for a user.
 * Primary admin gets all permissions via their role's role_permissions rows,
 * falling back to synthetic full-access only if role rows are missing.
 */
export async function getUserPermissions(userId: string): Promise<Array<{
  module_key: string;
  permission_key: string;
}>> {
  try {
    const user = await queryOne<{ role_id?: string; is_primary_admin?: boolean; business_id?: string }>(
      'SELECT role_id, is_primary_admin, business_id FROM users WHERE id = $1',
      [userId]
    );

    if (!user) {
      return [];
    }

    // Resolve role_id for primary admins without one
    let roleId = user.role_id;
    if (!roleId && user.is_primary_admin && user.business_id) {
      const primaryAdminRole = await queryOne<{ id: string }>(
        'SELECT id FROM user_roles WHERE business_id = $1 AND role_key = $2',
        [user.business_id, 'primary_admin']
      );
      if (primaryAdminRole) {
        roleId = primaryAdminRole.id;
      }
    }

    // Try to load from role_permissions first (consistent with enforcement path)
    if (roleId) {
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
         WHERE role_id = $1`,
        [roleId]
      );

      if (rolePerms.length > 0) {
        const permissions: Array<{ module_key: string; permission_key: string }> = [];
        for (const perm of rolePerms) {
          if (perm.can_view) permissions.push({ module_key: perm.module_key, permission_key: 'read' });
          if (perm.can_add) permissions.push({ module_key: perm.module_key, permission_key: 'create' });
          if (perm.can_modify) permissions.push({ module_key: perm.module_key, permission_key: 'update' });
          if (perm.can_delete) permissions.push({ module_key: perm.module_key, permission_key: 'delete' });
          if (perm.can_share) permissions.push({ module_key: perm.module_key, permission_key: 'export' });
        }
        return permissions;
      }
    }

    // Fallback for primary admin with missing role_permissions rows
    if (user.is_primary_admin) {
      const allModules = await queryRows<{ module_key: string }>(
        'SELECT module_key FROM permission_modules WHERE is_active = true'
      );
      const allActions = ['read', 'create', 'update', 'delete', 'export'];
      const permissions: Array<{ module_key: string; permission_key: string }> = [];
      for (const module of allModules) {
        for (const action of allActions) {
          permissions.push({ module_key: module.module_key, permission_key: action });
        }
      }
      return permissions;
    }

    return [];
  } catch (error) {
    console.error('Error getting user permissions:', error);
    return [];
  }
}

/**
 * Check field-level permission.
 * Fail-closed: returns false on error or missing config for 'edit' actions.
 */
export async function checkFieldPermission(
  roleId: string,
  moduleKey: string,
  fieldName: string,
  action: 'view' | 'edit'
): Promise<boolean> {
  try {
    const result = await queryOne<{ can_view: boolean; can_edit: boolean }>(
      `SELECT can_view, can_edit
       FROM field_permissions
       WHERE role_id = $1 AND module_key = $2 AND field_name = $3`,
      [roleId, moduleKey, fieldName]
    );

    if (!result) {
      // No field permission defined: allow view, deny edit (safe default)
      return action === 'view';
    }

    return action === 'view' ? result.can_view : result.can_edit;
  } catch (error) {
    console.error('Error checking field permission:', error);
    return false;
  }
}
