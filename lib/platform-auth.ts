/**
 * Platform Admin Authentication & Authorization
 * Completely separate from business user authentication
 */

import * as db from './db';
import bcrypt from 'bcryptjs';

export interface PlatformAdmin {
  id: string;
  name: string;
  email: string;
  role: 'super_admin' | 'admin' | 'support' | 'viewer';
  permissions: Record<string, boolean>;
  is_active: boolean;
  last_login_at: string | null;
}

/**
 * Role hierarchy and permissions
 */
const ROLE_HIERARCHY = ['viewer', 'support', 'admin', 'super_admin'];

const DEFAULT_PERMISSIONS: Record<string, Record<string, boolean>> = {
  super_admin: {
    can_manage_admins: true,
    can_manage_businesses: true,
    can_manage_subscriptions: true,
    can_manage_plans: true,
    can_view_metrics: true,
    can_view_logs: true,
    can_impersonate_business: true,
  },
  admin: {
    can_manage_admins: false,
    can_manage_businesses: true,
    can_manage_subscriptions: true,
    can_manage_plans: false,
    can_view_metrics: true,
    can_view_logs: true,
    can_impersonate_business: false,
  },
  support: {
    can_manage_admins: false,
    can_manage_businesses: false,
    can_manage_subscriptions: true,
    can_manage_plans: false,
    can_view_metrics: true,
    can_view_logs: false,
    can_impersonate_business: false,
  },
  viewer: {
    can_manage_admins: false,
    can_manage_businesses: false,
    can_manage_subscriptions: false,
    can_manage_plans: false,
    can_view_metrics: true,
    can_view_logs: false,
    can_impersonate_business: false,
  },
};

/**
 * Authenticate platform admin
 */
export async function authenticatePlatformAdmin(
  email: string,
  password: string
): Promise<{ admin: PlatformAdmin; sessionVersion: number } | null> {
  try {
    const admin = await db.queryOne(`
      SELECT 
        id, name, email, password_hash, role, 
        permissions, is_active, last_login_at
      FROM platform_admins
      WHERE email = $1 AND is_active = true
    `, [email.toLowerCase().trim()]);

    if (!admin) {
      return null;
    }

    // Verify password
    const isValid = await bcrypt.compare(password, admin.password_hash);
    if (!isValid) {
      return null;
    }

    const bumped = await db.queryOne<{ auth_session_version: string }>(`
      UPDATE platform_admins
      SET last_login_at = CURRENT_TIMESTAMP,
          auth_session_version = COALESCE(auth_session_version, 1) + 1
      WHERE id = $1 AND is_active = true
      RETURNING auth_session_version::text AS auth_session_version
    `, [admin.id]);

    const sessionVersion = Number(bumped?.auth_session_version ?? 1);

    // Parse permissions if string
    if (typeof admin.permissions === 'string') {
      admin.permissions = JSON.parse(admin.permissions);
    }

    const { password_hash, ...adminData } = admin;
    return { admin: adminData as PlatformAdmin, sessionVersion };
  } catch (error) {
    console.error('Error authenticating platform admin:', error);
    return null;
  }
}

/**
 * Get platform admin by ID
 */
export async function getPlatformAdmin(adminId: string): Promise<PlatformAdmin | null> {
  try {
    const admin = await db.queryOne(`
      SELECT 
        id, name, email, role, permissions, 
        is_active, last_login_at
      FROM platform_admins
      WHERE id = $1 AND is_active = true
    `, [adminId]);

    if (!admin) {
      return null;
    }

    // Parse permissions if string
    if (typeof admin.permissions === 'string') {
      admin.permissions = JSON.parse(admin.permissions);
    }

    return admin as PlatformAdmin;
  } catch (error) {
    console.error('Error fetching platform admin:', error);
    return null;
  }
}

/**
 * Check if admin has a specific permission
 */
export function hasPermission(admin: PlatformAdmin, permission: string): boolean {
  return admin.permissions[permission] === true;
}

/**
 * Check if admin role meets minimum required role
 */
export function hasMinimumRole(admin: PlatformAdmin, minRole: string): boolean {
  const adminRoleLevel = ROLE_HIERARCHY.indexOf(admin.role);
  const minRoleLevel = ROLE_HIERARCHY.indexOf(minRole);
  return adminRoleLevel >= minRoleLevel;
}

/**
 * Require platform admin authentication
 * Throws error if not authenticated or insufficient permissions
 */
export async function requirePlatformAdmin(
  adminId: string,
  minRole: string = 'viewer',
  requiredPermission?: string
): Promise<PlatformAdmin> {
  const admin = await getPlatformAdmin(adminId);

  if (!admin) {
    throw new Error('Platform admin not found or inactive');
  }

  if (!hasMinimumRole(admin, minRole)) {
    throw new Error(`Insufficient role. Required: ${minRole}, Current: ${admin.role}`);
  }

  if (requiredPermission && !hasPermission(admin, requiredPermission)) {
    throw new Error(`Missing permission: ${requiredPermission}`);
  }

  return admin;
}

/**
 * Load platform admin only if JWT session generation matches the DB (invalidates stale cookies).
 */
export async function getPlatformAdminIfSessionValid(
  adminId: string,
  sessionVersion: number
): Promise<PlatformAdmin | null> {
  try {
    const admin = await db.queryOne(`
      SELECT
        id, name, email, role, permissions,
        is_active, last_login_at, auth_session_version::text AS auth_session_version
      FROM platform_admins
      WHERE id = $1 AND is_active = true AND auth_session_version = $2
    `, [adminId, sessionVersion]);

    if (!admin) {
      return null;
    }

    if (typeof admin.permissions === 'string') {
      admin.permissions = JSON.parse(admin.permissions);
    }

    return admin as PlatformAdmin;
  } catch (error) {
    console.error('Error fetching platform admin session:', error);
    return null;
  }
}

/**
 * Create a new platform admin (super_admin only)
 */
export async function createPlatformAdmin(
  createdBy: string,
  data: {
    name: string;
    email: string;
    password: string;
    role: 'admin' | 'support' | 'viewer';
  }
): Promise<PlatformAdmin> {
  // Verify creator is super_admin
  const creator = await requirePlatformAdmin(createdBy, 'super_admin', 'can_manage_admins');

  const { name, email, password, role } = data;

  // Hash password
  const password_hash = await bcrypt.hash(password, 10);

  // Get default permissions for role
  const permissions = DEFAULT_PERMISSIONS[role];

  // Insert admin
  const admin = await db.queryOne(`
    INSERT INTO platform_admins (name, email, password_hash, role, permissions)
    VALUES ($1, $2, $3, $4, $5::jsonb)
    RETURNING id, name, email, role, permissions, is_active, last_login_at
  `, [name, email.toLowerCase().trim(), password_hash, role, JSON.stringify(permissions)]);

  // Log the action
  await logAdminAction(creator.id, 'create_admin', 'platform_admin', admin.id, {
    created_admin_email: email,
    role: role,
  });

  return admin as PlatformAdmin;
}

/**
 * Update platform admin
 */
export async function updatePlatformAdmin(
  updatedBy: string,
  adminId: string,
  updates: {
    name?: string;
    role?: 'admin' | 'support' | 'viewer';
    is_active?: boolean;
  }
): Promise<PlatformAdmin> {
  // Verify updater is super_admin
  await requirePlatformAdmin(updatedBy, 'super_admin', 'can_manage_admins');

  const setClauses: string[] = [];
  const values: any[] = [];
  let paramIndex = 1;

  if (updates.name) {
    setClauses.push(`name = $${paramIndex++}`);
    values.push(updates.name);
  }

  if (updates.role) {
    setClauses.push(`role = $${paramIndex++}`);
    values.push(updates.role);
    setClauses.push(`permissions = $${paramIndex++}::jsonb`);
    values.push(JSON.stringify(DEFAULT_PERMISSIONS[updates.role]));
  }

  if (updates.is_active !== undefined) {
    setClauses.push(`is_active = $${paramIndex++}`);
    values.push(updates.is_active);
  }

  if (setClauses.length === 0) {
    throw new Error('No updates provided');
  }

  setClauses.push(`updated_at = CURRENT_TIMESTAMP`);
  values.push(adminId);

  const admin = await db.queryOne(`
    UPDATE platform_admins
    SET ${setClauses.join(', ')}
    WHERE id = $${paramIndex}
    RETURNING id, name, email, role, permissions, is_active, last_login_at
  `, values);

  // Log the action
  await logAdminAction(updatedBy, 'update_admin', 'platform_admin', adminId, updates);

  return admin as PlatformAdmin;
}

/**
 * Log platform admin action
 */
export async function logAdminAction(
  adminId: string,
  action: string,
  entityType?: string,
  entityId?: string,
  details?: any,
  ipAddress?: string,
  userAgent?: string
): Promise<void> {
  try {
    await db.query(`
      INSERT INTO platform_admin_logs (
        admin_id, action, entity_type, entity_id, 
        details, ip_address, user_agent
      )
      VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7)
    `, [
      adminId,
      action,
      entityType || null,
      entityId || null,
      details ? JSON.stringify(details) : null,
      ipAddress || null,
      userAgent || null,
    ]);
  } catch (error) {
    console.error('Error logging admin action:', error);
    // Don't throw - logging failure shouldn't break the main action
  }
}

/**
 * List all platform admins (super_admin only)
 */
export async function listPlatformAdmins(requestedBy: string): Promise<PlatformAdmin[]> {
  await requirePlatformAdmin(requestedBy, 'super_admin', 'can_manage_admins');

  const admins = await db.queryRows(`
    SELECT 
      id, name, email, role, permissions, 
      is_active, last_login_at, created_at
    FROM platform_admins
    ORDER BY created_at DESC
  `);

  return admins as PlatformAdmin[];
}

