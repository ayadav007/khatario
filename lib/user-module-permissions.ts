import { queryRows, queryOne } from '@/lib/db';
import type { ModulePermission } from '@/lib/capability-snapshot';

export type UserModulePermissions = {
  permissions: Record<string, ModulePermission>;
  isPrimaryAdmin: boolean;
};

/**
 * A user's role permissions per module, in the shape the capability snapshot stores.
 * The account owner gets every active module with every flag on.
 */
export async function loadUserModulePermissions(userId: string): Promise<UserModulePermissions | null> {
  const user = await queryOne<{ role_id?: string; is_primary_admin?: boolean }>(
    'SELECT role_id, is_primary_admin FROM users WHERE id = $1',
    [userId]
  );
  if (!user) return null;

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

  const permissions: Record<string, ModulePermission> = {};

  if (isPrimaryAdmin) {
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
    const rolePerms = await queryRows<{ module_key: string } & ModulePermission>(
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

  return { permissions, isPrimaryAdmin };
}
