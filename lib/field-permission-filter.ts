/**
 * Field-level permission filter.
 * Strips fields from API responses based on the user's field_permissions.
 * Primary admins bypass filtering entirely.
 */

import { queryRows, queryOne } from '@/lib/db';

interface FieldRestriction {
  field_name: string;
  can_view: boolean;
  can_edit: boolean;
}

/**
 * Get field restrictions for a given role + module.
 * Returns a map of field_name -> { can_view, can_edit }.
 */
async function getFieldRestrictions(
  roleId: string,
  moduleKey: string
): Promise<Map<string, FieldRestriction>> {
  const rows = await queryRows<FieldRestriction>(
    `SELECT field_name, can_view, can_edit FROM field_permissions WHERE role_id = $1 AND module_key = $2`,
    [roleId, moduleKey]
  );
  const map = new Map<string, FieldRestriction>();
  for (const row of rows) {
    map.set(row.field_name, row);
  }
  return map;
}

/**
 * Filter an object or array of objects by removing fields the user cannot view.
 * Returns a new object/array (does not mutate input).
 *
 * @param data      Single record or array of records
 * @param userId    Authenticated user ID
 * @param moduleKey Module (e.g. 'invoices', 'employees')
 * @returns         Filtered data with restricted fields replaced by null
 */
export async function filterFieldsByPermission<T extends Record<string, any>>(
  data: T | T[],
  userId: string,
  moduleKey: string
): Promise<T | T[]> {
  const user = await queryOne<{ role_id?: string; is_primary_admin?: boolean; business_id?: string }>(
    'SELECT role_id, is_primary_admin, business_id FROM users WHERE id = $1',
    [userId]
  );
  if (!user) return data;
  if (user.is_primary_admin) return data;

  let roleId = user.role_id;
  if (!roleId && user.business_id) {
    const role = await queryOne<{ id: string }>(
      'SELECT id FROM user_roles WHERE business_id = $1 AND role_key = $2',
      [user.business_id, 'primary_admin']
    );
    if (role) roleId = role.id;
  }
  if (!roleId) return data;

  const restrictions = await getFieldRestrictions(roleId, moduleKey);
  if (restrictions.size === 0) return data;

  function filterRecord(record: T): T {
    const filtered = { ...record };
    for (const [fieldName, perm] of restrictions) {
      if (!perm.can_view && fieldName in filtered) {
        (filtered as any)[fieldName] = null;
      }
    }
    return filtered;
  }

  if (Array.isArray(data)) {
    return data.map(filterRecord);
  }
  return filterRecord(data);
}

/**
 * Get editable fields for a given user + module.
 * Returns a Set of field names the user CAN edit.
 * Fields not in field_permissions are assumed non-editable (fail-closed for edit).
 */
export async function getEditableFields(
  userId: string,
  moduleKey: string
): Promise<Set<string>> {
  const user = await queryOne<{ role_id?: string; is_primary_admin?: boolean; business_id?: string }>(
    'SELECT role_id, is_primary_admin, business_id FROM users WHERE id = $1',
    [userId]
  );
  if (!user) return new Set();
  if (user.is_primary_admin) return new Set(['*']); // Wildcard = all allowed

  let roleId = user.role_id;
  if (!roleId) return new Set();

  const rows = await queryRows<{ field_name: string }>(
    `SELECT field_name FROM field_permissions WHERE role_id = $1 AND module_key = $2 AND can_edit = true`,
    [roleId, moduleKey]
  );
  return new Set(rows.map(r => r.field_name));
}
