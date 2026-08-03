import { NextRequest, NextResponse } from 'next/server';
import { queryRows } from '@/lib/db';
import {
  buildRbacCatalogFromModules,
  type PermissionModuleRow,
} from '@/lib/rbac-permission-catalog';
import {
  normalizePlatformModule,
  type PlatformModule,
} from '@/lib/platform-modules';

export const dynamic = 'force-dynamic';

function parseEnabledModules(searchParams: URLSearchParams): PlatformModule[] | undefined {
  const raw = searchParams.get('enabled_modules');
  if (!raw) return undefined;
  const parsed = raw
    .split(',')
    .map((s) => normalizePlatformModule(s.trim()))
    .filter((m): m is PlatformModule => m !== null);
  return parsed.length ? parsed : undefined;
}

/**
 * GET /api/permissions
 * List assignable RBAC permissions from permission_modules (module_key system).
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const enabledModules = parseEnabledModules(searchParams);
    const moduleKey = searchParams.get('module_key');

    let sql = `
      SELECT module_key, module_name, display_order
      FROM permission_modules
      WHERE is_active = true
    `;
    const params: string[] = [];

    if (moduleKey) {
      sql += ` AND module_key = $1`;
      params.push(moduleKey);
    }

    sql += ` ORDER BY display_order NULLS LAST, module_name ASC`;

    const modules = await queryRows<PermissionModuleRow>(sql, params);
    const permissions = buildRbacCatalogFromModules(modules, enabledModules);

    return NextResponse.json({ permissions });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    console.error('Error fetching permissions:', error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
