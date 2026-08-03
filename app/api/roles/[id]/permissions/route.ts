import { NextRequest, NextResponse } from 'next/server';
import { queryRows, queryOne, query } from '@/lib/db';
import {
  RBAC_STANDARD_ACTIONS,
  buildRbacCatalogFromModules,
  parseSyntheticPermissionId,
  type PermissionModuleRow,
} from '@/lib/rbac-permission-catalog';

export const dynamic = 'force-dynamic';

async function usesModuleKeyRolePermissions(): Promise<boolean> {
  const row = await queryOne(`
    SELECT EXISTS (
      SELECT FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'role_permissions'
        AND column_name = 'module_key'
    ) as exists
  `);
  return row?.exists === true;
}

function permissionsPayloadToModuleFlags(
  permissions: Array<{ permission_id: string; granted: boolean }>,
): Record<string, { can_view: boolean; can_add: boolean; can_modify: boolean; can_delete: boolean; can_share: boolean }> {
  const modulePerms: Record<
    string,
    { can_view: boolean; can_add: boolean; can_modify: boolean; can_delete: boolean; can_share: boolean }
  > = {};

  for (const perm of permissions) {
    const parsed = parseSyntheticPermissionId(perm.permission_id);
    if (!parsed) continue;

    if (!modulePerms[parsed.moduleKey]) {
      modulePerms[parsed.moduleKey] = {
        can_view: false,
        can_add: false,
        can_modify: false,
        can_delete: false,
        can_share: false,
      };
    }

    const actionDef = RBAC_STANDARD_ACTIONS.find((a) => a.key === parsed.action);
    if (!actionDef) continue;
    modulePerms[parsed.moduleKey][actionDef.flag] = perm.granted === true;
  }

  return modulePerms;
}

async function saveModuleKeyPermissions(
  roleId: string,
  permissions: Array<{ permission_id: string; granted: boolean }>,
): Promise<void> {
  await query('DELETE FROM role_permissions WHERE role_id = $1', [roleId]);

  const modulePerms = permissionsPayloadToModuleFlags(permissions);
  for (const [moduleKey, flags] of Object.entries(modulePerms)) {
    const hasAny =
      flags.can_view || flags.can_add || flags.can_modify || flags.can_delete || flags.can_share;
    if (!hasAny) continue;

    await query(
      `INSERT INTO role_permissions (role_id, module_key, can_view, can_add, can_modify, can_delete, can_share)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (role_id, module_key) DO UPDATE SET
         can_view = EXCLUDED.can_view,
         can_add = EXCLUDED.can_add,
         can_modify = EXCLUDED.can_modify,
         can_delete = EXCLUDED.can_delete,
         can_share = EXCLUDED.can_share`,
      [
        roleId,
        moduleKey,
        flags.can_view,
        flags.can_add,
        flags.can_modify,
        flags.can_delete,
        flags.can_share,
      ],
    );
  }
}

/**
 * GET /api/roles/[id]/permissions
 * Get all permissions for a role
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const roleId = params.id;

    // Check if new permissions table exists (migration 059)
    const tableExists = await queryOne(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name = 'permissions'
      )
    `);

    if (!tableExists?.exists) {
      // Old system: Use module-based permissions
      // First check if role_permissions table has the old schema (module_key column)
      const hasModuleKey = await queryOne(`
        SELECT EXISTS (
          SELECT FROM information_schema.columns 
          WHERE table_schema = 'public' 
          AND table_name = 'role_permissions'
          AND column_name = 'module_key'
        )
      `);

      if (!hasModuleKey?.exists) {
        // Neither system is set up properly
        return NextResponse.json({ permissions: [] });
      }

      const modules = await queryRows(`
        SELECT 
          pm.module_key,
          pm.module_name,
          COALESCE(rp.can_view, false) as can_view,
          COALESCE(rp.can_add, false) as can_add,
          COALESCE(rp.can_modify, false) as can_modify,
          COALESCE(rp.can_delete, false) as can_delete,
          COALESCE(rp.can_share, false) as can_share
        FROM permission_modules pm
        LEFT JOIN role_permissions rp ON rp.module_key = pm.module_key AND rp.role_id = $1
        WHERE pm.is_active = true
        ORDER BY 
          CASE WHEN pm.display_order IS NOT NULL THEN pm.display_order ELSE 999 END ASC,
          pm.module_name ASC
      `, [roleId]);

      // Convert to new format for frontend compatibility
      const actions = [
        { key: 'create', name: 'Create', flag: 'can_add' },
        { key: 'read', name: 'Read', flag: 'can_view' },
        { key: 'update', name: 'Update', flag: 'can_modify' },
        { key: 'delete', name: 'Delete', flag: 'can_delete' },
        { key: 'export', name: 'Export', flag: 'can_share' },
      ];

      const permissions = [];
      for (const module of modules) {
        for (const action of actions) {
          const flagValue = module[action.flag as keyof typeof module];
          // Handle boolean values from database (could be boolean, string, or null)
          const isGranted = flagValue === true || flagValue === 'true' || flagValue === 1 || flagValue === '1';
          
          permissions.push({
            id: `${module.module_key}_${action.key}`,
            role_id: roleId,
            permission_id: `${module.module_key}_${action.key}`,
            granted: isGranted,
            created_at: null,
            permission_key: action.key,
            permission_name: action.name,
            module_key: module.module_key,
            module_name: module.module_name,
          });
        }
      }

      return NextResponse.json({ permissions });
    }

    // New system: Use permissions table
    const rolePermissions = await queryRows<{
      id: string | null;
      role_id: string | null;
      permission_id: string;
      granted: boolean | null;
      created_at: Date | null;
      permission_key: string;
      permission_name: string;
      module_key: string;
      module_name: string;
    }>(
      `SELECT 
        rp.id,
        rp.role_id,
        p.id as permission_id,
        COALESCE(rp.granted, false) as granted,
        rp.created_at,
        p.permission_key,
        p.permission_name,
        pm.module_key,
        pm.module_name
      FROM permissions p
      INNER JOIN permission_modules pm ON p.module_id = pm.id
      LEFT JOIN role_permissions rp ON rp.permission_id = p.id AND rp.role_id = $1
      WHERE p.is_active = true AND pm.is_active = true
      ORDER BY pm.module_name ASC, p.permission_name ASC`,
      [roleId]
    );

    return NextResponse.json({ permissions: rolePermissions });
  } catch (error: any) {
    console.error('Error fetching role permissions:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/roles/[id]/permissions
 * Update permissions for a role
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const roleId = params.id;
    const body = await request.json();
    const { permissions } = body; // Array of { permission_id, granted }

    if (!Array.isArray(permissions)) {
      return NextResponse.json(
        { error: 'permissions must be an array' },
        { status: 400 }
      );
    }

    // Verify role exists
    const role = await queryOne(
      'SELECT id FROM user_roles WHERE id = $1',
      [roleId]
    );

    if (!role) {
      return NextResponse.json(
        { error: 'Role not found' },
        { status: 404 }
      );
    }

    // Check if new permissions table exists (migration 059)
    const tableExists = await queryOne(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name = 'permissions'
      )
    `);

    if (!tableExists?.exists || (await usesModuleKeyRolePermissions())) {
      await saveModuleKeyPermissions(roleId, permissions);
      return NextResponse.json({ success: true, message: 'Permissions updated' });
    }

    // Legacy permissions-table path (rare environments)
    await query('DELETE FROM role_permissions WHERE role_id = $1', [roleId]);

    for (const perm of permissions) {
      if (perm.granted) {
        await query(
          'INSERT INTO role_permissions (role_id, permission_id, granted) VALUES ($1, $2, true) ON CONFLICT (role_id, permission_id) DO UPDATE SET granted = true',
          [roleId, perm.permission_id]
        );
      }
    }

    const updatedPermissions = await queryRows(
      'SELECT * FROM role_permissions WHERE role_id = $1',
      [roleId]
    );

    return NextResponse.json({ permissions: updatedPermissions });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    console.error('Error updating role permissions:', error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

