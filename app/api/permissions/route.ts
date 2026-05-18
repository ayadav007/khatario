import { NextRequest, NextResponse } from 'next/server';
import { queryRows, queryOne } from '@/lib/db';
import { Permission } from '@/types/database';

/**
 * GET /api/permissions
 * List all permissions, optionally filtered by module
 */
export async function GET(request: NextRequest) {
  try {
    // Check if new permissions table exists (migration 059)
    const tableExists = await queryOne(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name = 'permissions'
      )
    `);

    if (!tableExists?.exists) {
      // Old system: Return permissions based on modules and actions
      const modules = await queryRows(`
        SELECT 
          module_key,
          module_name,
          description
        FROM permission_modules
        WHERE is_active = true
        ORDER BY display_order ASC, module_name ASC
      `);

      // Generate permissions for each module (old system style)
      const permissions = [];
      const actions = [
        { key: 'create', name: 'Create' },
        { key: 'read', name: 'Read' },
        { key: 'update', name: 'Update' },
        { key: 'delete', name: 'Delete' },
        { key: 'export', name: 'Export' },
      ];

      for (const module of modules) {
        for (const action of actions) {
          permissions.push({
            id: `${module.module_key}_${action.key}`, // Synthetic ID
            permission_key: action.key,
            permission_name: action.name,
            module_key: module.module_key,
            module_name: module.module_name,
            description: `${action.name} ${module.module_name}`,
          });
        }
      }

      return NextResponse.json({ permissions });
    }

    // New system: Use permissions table
    const { searchParams } = new URL(request.url);
    const moduleId = searchParams.get('module_id');
    const moduleKey = searchParams.get('module_key');

    let sql = `
      SELECT 
        p.*,
        pm.module_key,
        pm.module_name as module_name
      FROM permissions p
      INNER JOIN permission_modules pm ON p.module_id = pm.id
      WHERE p.is_active = true
    `;
    const params: any[] = [];

    if (moduleId) {
      sql += ` AND p.module_id = $1`;
      params.push(moduleId);
    } else if (moduleKey) {
      sql += ` AND pm.module_key = $1`;
      params.push(moduleKey);
    }

    sql += ` ORDER BY pm.module_name ASC, p.permission_name ASC`;

    const permissions = await queryRows<Permission & {
      module_key: string;
      module_name: string;
    }>(sql, params);

    return NextResponse.json({ permissions });
  } catch (error: any) {
    console.error('Error fetching permissions:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}

