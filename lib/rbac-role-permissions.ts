/**
 * Role permission management: the only write path for role_permissions from the Roles screen and
 * the settings role APIs. Callers pass the session actor and session business; this module scopes
 * the role to that business, validates the payload against the active permission catalog, refuses
 * grants beyond the actor's own authority, and writes permissions plus the audit row in one
 * transaction under a row lock on the role.
 */

import type { PoolClient } from 'pg';
import { NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import { RBAC_STANDARD_ACTIONS, type RbacPermissionFlag } from '@/lib/rbac-permission-catalog';

export type PermissionFlags = Record<RbacPermissionFlag, boolean>;
export type PermissionMap = Map<string, PermissionFlags>;

export type ActiveModule = { module_key: string; module_name: string; display_order: number | null };

export type PermissionChange = {
  module_key: string;
  action: string;
  from: boolean;
  to: boolean;
};

export class RolePermissionError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'RolePermissionError';
  }

  toNextResponse(): NextResponse {
    return NextResponse.json(
      { error: this.message, code: this.code, ...(this.details ? { details: this.details } : {}) },
      { status: this.status }
    );
  }
}

const FLAGS = RBAC_STANDARD_ACTIONS.map((a) => a.flag);
const ACTION_BY_FLAG = Object.fromEntries(RBAC_STANDARD_ACTIONS.map((a) => [a.flag, a.key])) as Record<
  RbacPermissionFlag,
  string
>;
const FLAG_BY_ACTION = Object.fromEntries(RBAC_STANDARD_ACTIONS.map((a) => [a.key, a.flag])) as Record<
  string,
  RbacPermissionFlag
>;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const PRIMARY_ADMIN_ROLE_KEY = 'primary_admin';

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID.test(value);
}

function emptyFlags(): PermissionFlags {
  return { can_view: false, can_add: false, can_modify: false, can_delete: false, can_share: false };
}

function hasAny(flags: PermissionFlags): boolean {
  return FLAGS.some((f) => flags[f]);
}

function invalid(errors: string[]): RolePermissionError {
  return new RolePermissionError(400, 'INVALID_PERMISSIONS', 'One or more requested permissions are invalid.', {
    errors,
  });
}

export async function loadActiveModules(q: PoolClient): Promise<Map<string, ActiveModule>> {
  const rows = (
    await q.query<ActiveModule>(
      `SELECT module_key, module_name, display_order
         FROM permission_modules
        WHERE is_active = true
        ORDER BY display_order NULLS LAST, module_name ASC`
    )
  ).rows;
  return new Map(rows.map((r) => [r.module_key, r]));
}

/** `[{ permission_id: '<module>_<action>', granted: boolean }]` as sent by the Roles screen. */
export function parsePermissionIdPayload(raw: unknown, active: Map<string, ActiveModule>): PermissionMap {
  if (!Array.isArray(raw)) throw invalid(['permissions must be an array']);
  const out: PermissionMap = new Map();
  const seen = new Map<string, boolean>();
  const errors: string[] = [];

  raw.forEach((entry, i) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      errors.push(`permissions[${i}] must be an object`);
      return;
    }
    const { permission_id, granted } = entry as Record<string, unknown>;
    if (typeof permission_id !== 'string' || permission_id === '') {
      errors.push(`permissions[${i}].permission_id must be a non-empty string`);
      return;
    }
    if (typeof granted !== 'boolean') {
      errors.push(`permissions[${i}].granted must be a boolean`);
      return;
    }
    const sep = permission_id.lastIndexOf('_');
    const moduleKey = sep > 0 ? permission_id.slice(0, sep) : '';
    const action = sep > 0 ? permission_id.slice(sep + 1) : '';
    const flag = FLAG_BY_ACTION[action];
    if (!flag) {
      errors.push(`Unsupported action in permission "${permission_id}"`);
      return;
    }
    if (!active.has(moduleKey)) {
      errors.push(`Unknown or inactive module in permission "${permission_id}"`);
      return;
    }
    const prior = seen.get(permission_id);
    if (prior !== undefined && prior !== granted) {
      errors.push(`Conflicting values for permission "${permission_id}"`);
      return;
    }
    seen.set(permission_id, granted);
    const flags = out.get(moduleKey) ?? emptyFlags();
    flags[flag] = granted;
    out.set(moduleKey, flags);
  });

  if (errors.length) throw invalid(errors);
  return out;
}

const MODULE_FLAG_KEYS = new Set<string>(['module_key', ...FLAGS]);

/** `[{ module_key, can_view?, can_add?, can_modify?, can_delete?, can_share? }]`; omitted flags are false. */
export function parseModuleFlagsPayload(raw: unknown, active: Map<string, ActiveModule>): PermissionMap {
  if (!Array.isArray(raw)) throw invalid(['permissions must be an array']);
  const out: PermissionMap = new Map();
  const errors: string[] = [];

  raw.forEach((entry, i) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      errors.push(`permissions[${i}] must be an object`);
      return;
    }
    const obj = entry as Record<string, unknown>;
    const unknownKeys = Object.keys(obj).filter((k) => !MODULE_FLAG_KEYS.has(k));
    if (unknownKeys.length) {
      errors.push(`permissions[${i}] has unsupported fields: ${unknownKeys.join(', ')}`);
      return;
    }
    const moduleKey = obj.module_key;
    if (typeof moduleKey !== 'string' || !active.has(moduleKey)) {
      errors.push(`permissions[${i}].module_key is unknown or inactive`);
      return;
    }
    if (out.has(moduleKey)) {
      errors.push(`Module "${moduleKey}" appears more than once`);
      return;
    }
    const flags = emptyFlags();
    for (const f of FLAGS) {
      const v = obj[f];
      if (v === undefined) continue;
      if (typeof v !== 'boolean') {
        errors.push(`permissions[${i}].${f} must be a boolean`);
        return;
      }
      flags[f] = v;
    }
    out.set(moduleKey, flags);
  });

  if (errors.length) throw invalid(errors);
  return out;
}

async function loadRolePermissions(q: PoolClient, roleId: string): Promise<PermissionMap> {
  const rows = (
    await q.query<{ module_key: string } & PermissionFlags>(
      `SELECT module_key, can_view, can_add, can_modify, can_delete, can_share
         FROM role_permissions WHERE role_id = $1`,
      [roleId]
    )
  ).rows;
  const map: PermissionMap = new Map();
  for (const r of rows) {
    const flags = emptyFlags();
    for (const f of FLAGS) flags[f] = r[f] === true;
    map.set(r.module_key, flags);
  }
  return map;
}

type Authority = { unlimited: boolean; held: PermissionMap; actorName: string | null };

/**
 * Primary-admin authority comes from users.is_primary_admin for the session business only. Other
 * actors may grant only the flags their own role (in the session business) holds.
 */
async function loadActorAuthority(q: PoolClient, actorId: string, businessId: string): Promise<Authority> {
  const user = (
    await q.query<{ name: string | null; is_primary_admin: boolean | null; business_id: string | null; role_id: string | null }>(
      `SELECT name, is_primary_admin, business_id, role_id FROM users WHERE id = $1 AND is_active = true`,
      [actorId]
    )
  ).rows[0];
  if (!user) {
    throw new RolePermissionError(401, 'UNAUTHENTICATED', 'Authentication required');
  }
  if (user.is_primary_admin === true && user.business_id === businessId) {
    return { unlimited: true, held: new Map(), actorName: user.name };
  }
  let held: PermissionMap = new Map();
  if (user.role_id) {
    const ownRole = (
      await q.query(`SELECT 1 FROM user_roles WHERE id = $1 AND business_id = $2`, [user.role_id, businessId])
    ).rowCount;
    if (ownRole) held = await loadRolePermissions(q, user.role_id);
  }
  return { unlimited: false, held, actorName: user.name };
}

function diff(before: PermissionMap, after: PermissionMap): PermissionChange[] {
  const modules = [...new Set([...before.keys(), ...after.keys()])].sort();
  const changes: PermissionChange[] = [];
  for (const m of modules) {
    const b = before.get(m) ?? emptyFlags();
    const a = after.get(m) ?? emptyFlags();
    for (const f of FLAGS) {
      if (b[f] !== a[f]) changes.push({ module_key: m, action: ACTION_BY_FLAG[f], from: b[f], to: a[f] });
    }
  }
  return changes;
}

function assertWithinAuthority(changes: PermissionChange[], authority: Authority): void {
  if (authority.unlimited) return;
  const exceeded = changes
    .filter((c) => c.to && !c.from)
    .filter((c) => !authority.held.get(c.module_key)?.[FLAG_BY_ACTION[c.action]])
    .map((c) => `${c.module_key}_${c.action}`);
  if (exceeded.length) {
    throw new RolePermissionError(
      403,
      'PERMISSION_GRANT_EXCEEDS_AUTHORITY',
      'You cannot grant permissions that you do not hold yourself.',
      { permissions: exceeded }
    );
  }
}

async function writeChanges(q: PoolClient, roleId: string, before: PermissionMap, after: PermissionMap): Promise<void> {
  const modules = new Set([...before.keys(), ...after.keys()]);
  for (const m of modules) {
    const b = before.get(m);
    const a = after.get(m) ?? emptyFlags();
    if (b && FLAGS.every((f) => b[f] === a[f])) continue;
    if (!hasAny(a)) {
      await q.query(`DELETE FROM role_permissions WHERE role_id = $1 AND module_key = $2`, [roleId, m]);
      continue;
    }
    await q.query(
      `INSERT INTO role_permissions (role_id, module_key, can_view, can_add, can_modify, can_delete, can_share)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (role_id, module_key) DO UPDATE SET
         can_view = EXCLUDED.can_view,
         can_add = EXCLUDED.can_add,
         can_modify = EXCLUDED.can_modify,
         can_delete = EXCLUDED.can_delete,
         can_share = EXCLUDED.can_share,
         updated_at = CURRENT_TIMESTAMP`,
      [roleId, m, a.can_view, a.can_add, a.can_modify, a.can_delete, a.can_share]
    );
  }
}

async function writeAudit(
  q: PoolClient,
  p: {
    businessId: string;
    actorId: string;
    actorName: string | null;
    action: string;
    roleId: string;
    details: Record<string, unknown>;
    ipAddress?: string | null;
    userAgent?: string | null;
  }
): Promise<void> {
  await q.query(
    `INSERT INTO user_activity_logs (business_id, user_id, user_name, action, module, entity_type, entity_id, details, ip_address, user_agent)
     VALUES ($1, $2, $3, $4, 'settings', 'role', $5, $6, $7, $8)`,
    [
      p.businessId,
      p.actorId,
      p.actorName ?? 'Unknown',
      p.action,
      p.roleId,
      JSON.stringify(p.details),
      p.ipAddress ?? null,
      p.userAgent ?? null,
    ]
  );
}

async function inTransaction<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const out = await fn(client);
    await client.query('COMMIT');
    return out;
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

type RoleRow = { id: string; role_name: string; role_key: string };

/** Role in the session business, or null. Never reveals roles from other businesses. */
export async function findRoleInBusiness(
  q: Pick<PoolClient, 'query'>,
  roleId: string,
  businessId: string,
  forUpdate = false
): Promise<RoleRow | null> {
  if (!isUuid(roleId)) return null;
  const res = await q.query<RoleRow>(
    `SELECT id, role_name, role_key FROM user_roles WHERE id = $1 AND business_id = $2${forUpdate ? ' FOR UPDATE' : ''}`,
    [roleId, businessId]
  );
  return res.rows[0] ?? null;
}

export type RequestMeta = { ipAddress?: string | null; userAgent?: string | null };

/**
 * `replace`: every active catalog module takes the requested flags (absent = none); rows for
 * modules outside the active catalog are left untouched. `merge`: only the listed modules change.
 */
export async function updateRolePermissions(p: {
  actorId: string;
  businessId: string;
  roleId: string;
  mode: 'replace' | 'merge';
  parse: (active: Map<string, ActiveModule>) => PermissionMap;
  meta?: RequestMeta;
}): Promise<{ role: RoleRow; changes: PermissionChange[] }> {
  return inTransaction(async (c) => {
    const role = await findRoleInBusiness(c, p.roleId, p.businessId, true);
    if (!role) throw new RolePermissionError(404, 'ROLE_NOT_FOUND', 'Role not found');
    if (role.role_key === PRIMARY_ADMIN_ROLE_KEY) {
      throw new RolePermissionError(403, 'PRIMARY_ADMIN_ROLE_PROTECTED', 'Cannot modify Primary Admin permissions');
    }

    const active = await loadActiveModules(c);
    const requested = p.parse(active);
    const before = await loadRolePermissions(c, role.id);
    const after: PermissionMap = new Map([...before].map(([k, v]) => [k, { ...v }]));
    if (p.mode === 'replace') {
      for (const m of active.keys()) after.set(m, requested.get(m) ?? emptyFlags());
    } else {
      for (const [m, flags] of requested) after.set(m, flags);
    }

    const changes = diff(before, after);
    const authority = await loadActorAuthority(c, p.actorId, p.businessId);
    assertWithinAuthority(changes, authority);

    await writeChanges(c, role.id, before, after);
    await writeAudit(c, {
      businessId: p.businessId,
      actorId: p.actorId,
      actorName: authority.actorName,
      action: 'update_role_permissions',
      roleId: role.id,
      details: { role_name: role.role_name, changes },
      ...p.meta,
    });
    return { role, changes };
  });
}

export async function createRole(p: {
  actorId: string;
  businessId: string;
  roleName: unknown;
  description: unknown;
  permissions: unknown;
  meta?: RequestMeta;
}): Promise<{ role: Record<string, unknown>; changes: PermissionChange[] }> {
  const roleName = typeof p.roleName === 'string' ? p.roleName.trim() : '';
  if (!roleName || roleName.length > 100) {
    throw new RolePermissionError(400, 'INVALID_ROLE_NAME', 'role_name is required (1-100 characters)');
  }
  if (p.description != null && typeof p.description !== 'string') {
    throw new RolePermissionError(400, 'INVALID_DESCRIPTION', 'description must be a string');
  }
  const description = typeof p.description === 'string' && p.description.trim() ? p.description.trim() : null;
  const roleKey = roleName.toLowerCase().replace(/\s+/g, '_') + '_custom';
  if (roleKey.length > 50) {
    throw new RolePermissionError(400, 'INVALID_ROLE_NAME', 'role_name is too long');
  }

  try {
    return await inTransaction(async (c) => {
      const active = await loadActiveModules(c);
      const authority = await loadActorAuthority(c, p.actorId, p.businessId);

      let requested: PermissionMap;
      if (p.permissions == null) {
        // Default: view-only on every active module the creator may grant.
        requested = new Map();
        for (const m of active.keys()) {
          if (authority.unlimited || authority.held.get(m)?.can_view) {
            requested.set(m, { ...emptyFlags(), can_view: true });
          }
        }
      } else {
        requested = parseModuleFlagsPayload(p.permissions, active);
      }

      const changes = diff(new Map(), requested);
      assertWithinAuthority(changes, authority);

      const existing = (
        await c.query<{ id: string; role_name: string; is_active: boolean }>(
          `SELECT id, role_name, is_active FROM user_roles
            WHERE business_id = $1 AND (role_key = $2 OR LOWER(TRIM(role_name)) = LOWER(TRIM($3)))`,
          [p.businessId, roleKey, roleName]
        )
      ).rows[0];
      if (existing) {
        throw new RolePermissionError(
          409,
          'ROLE_EXISTS',
          existing.is_active
            ? 'A role with this name already exists. Please use a different name.'
            : 'A role with this name already exists but is inactive. Please use a different name or reactivate the existing role.',
          { existingRoleId: existing.id, existingRoleName: existing.role_name, isInactive: !existing.is_active }
        );
      }

      const role = (
        await c.query(
          `INSERT INTO user_roles (business_id, role_name, role_key, description, is_system_role, is_active)
           VALUES ($1, $2, $3, $4, false, true)
           RETURNING id, business_id, role_name, role_key, description, is_system_role, is_active, created_at`,
          [p.businessId, roleName, roleKey, description]
        )
      ).rows[0];

      await writeChanges(c, role.id, new Map(), requested);
      await writeAudit(c, {
        businessId: p.businessId,
        actorId: p.actorId,
        actorName: authority.actorName,
        action: 'create_role',
        roleId: role.id,
        details: { role_name: roleName, changes },
        ...p.meta,
      });
      return { role, changes };
    });
  } catch (e) {
    if ((e as { code?: string })?.code === '23505') {
      throw new RolePermissionError(409, 'ROLE_EXISTS', 'A role with this name already exists. Please use a different name.');
    }
    throw e;
  }
}

/**
 * Deactivate a custom role in the session business. System roles and roles still held by an
 * active user are refused; the role's permission rows are kept for the audit trail.
 */
export async function deactivateRole(p: {
  actorId: string;
  businessId: string;
  roleId: string;
  meta?: RequestMeta;
}): Promise<{ role: RoleRow }> {
  return inTransaction(async (c) => {
    if (!isUuid(p.roleId)) throw new RolePermissionError(404, 'ROLE_NOT_FOUND', 'Role not found');
    const role = (
      await c.query<RoleRow & { is_system_role: boolean; is_active: boolean }>(
        `SELECT id, role_name, role_key, is_system_role, is_active
           FROM user_roles WHERE id = $1 AND business_id = $2 FOR UPDATE`,
        [p.roleId, p.businessId]
      )
    ).rows[0];
    if (!role || !role.is_active) throw new RolePermissionError(404, 'ROLE_NOT_FOUND', 'Role not found');
    if (role.is_system_role || role.role_key === PRIMARY_ADMIN_ROLE_KEY) {
      throw new RolePermissionError(403, 'SYSTEM_ROLE_PROTECTED', 'Built-in roles cannot be deactivated');
    }
    const holders = Number(
      (
        await c.query<{ count: string }>(
          `SELECT COUNT(*)::text AS count FROM users WHERE role_id = $1 AND business_id = $2 AND is_active = true`,
          [role.id, p.businessId]
        )
      ).rows[0]?.count ?? 0
    );
    if (holders > 0) {
      throw new RolePermissionError(
        409,
        'ROLE_IN_USE',
        'Move or deactivate the users on this role before deactivating it.',
        { activeUsers: holders }
      );
    }
    await c.query(`UPDATE user_roles SET is_active = false WHERE id = $1`, [role.id]);
    const authority = await loadActorAuthority(c, p.actorId, p.businessId);
    await writeAudit(c, {
      businessId: p.businessId,
      actorId: p.actorId,
      actorName: authority.actorName,
      action: 'deactivate_role',
      roleId: role.id,
      details: { role_name: role.role_name },
      ...p.meta,
    });
    return { role: { id: role.id, role_name: role.role_name, role_key: role.role_key } };
  });
}

/** Flags for every active module on a role in the session business (for the GET routes). */
export async function readRolePermissions(
  roleId: string,
  businessId: string
): Promise<{ role: RoleRow; modules: ActiveModule[]; flags: PermissionMap } | null> {
  const client = await getPool().connect();
  try {
    const role = await findRoleInBusiness(client, roleId, businessId);
    if (!role) return null;
    const active = await loadActiveModules(client);
    const flags = await loadRolePermissions(client, role.id);
    return { role, modules: [...active.values()], flags };
  } finally {
    client.release();
  }
}

export function requestMeta(request: Request): RequestMeta {
  const fwd = request.headers.get('x-forwarded-for');
  return {
    ipAddress: (fwd ? fwd.split(',')[0].trim() : request.headers.get('x-real-ip')) || null,
    userAgent: request.headers.get('user-agent'),
  };
}
