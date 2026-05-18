import { NextRequest, NextResponse } from 'next/server';
import { queryRows } from '@/lib/db';
import { PermissionModule } from '@/types/database';

/**
 * GET /api/permissions/modules
 * List all permission modules
 */
export async function GET(request: NextRequest) {
  try {
    const modules = await queryRows<PermissionModule>(
      'SELECT * FROM permission_modules WHERE is_active = true ORDER BY module_name ASC'
    );

    return NextResponse.json({ modules });
  } catch (error: any) {
    console.error('Error fetching permission modules:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}

