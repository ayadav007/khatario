import { NextRequest, NextResponse } from 'next/server';
import { query, queryOne, queryRows } from '@/lib/db';
import { authorize, AuthorizationError } from '@/lib/authorization';

/**
 * POST /api/settings/roles/ensure-primary-admin-permissions
 * Ensures Primary Admin role has all permissions for all modules
 * This fixes the issue where new modules were added but Primary Admin doesn't have permissions
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { business_id, user_id } = body;

    if (!business_id || !user_id) {
      return NextResponse.json(
        { error: 'business_id and user_id are required' },
        { status: 400 }
      );
    }

    // AUTHORIZATION: Only allow if user has settings.update permission
    try {
      await authorize(user_id, 'settings', 'update', { businessId: business_id });
    } catch (error) {
      if (error instanceof AuthorizationError) {
        return error.toNextResponse();
      }
      throw error;
    }

    // Get Primary Admin role for this business
    const primaryAdminRole = await queryOne<{ id: string }>(
      `SELECT id FROM user_roles 
       WHERE business_id = $1 AND role_key = 'primary_admin'`,
      [business_id]
    );

    if (!primaryAdminRole) {
      return NextResponse.json(
        { error: 'Primary Admin role not found for this business' },
        { status: 404 }
      );
    }

    // Get all active permission modules
    const modules = await queryRows<{ module_key: string }>(
      'SELECT module_key FROM permission_modules WHERE is_active = true'
    );

    if (modules.length === 0) {
      return NextResponse.json(
        { error: 'No permission modules found' },
        { status: 500 }
      );
    }

    // Ensure Primary Admin has all permissions for all modules
    let updatedCount = 0;
    let insertedCount = 0;

    for (const module of modules) {
      const existing = await queryOne(
        `SELECT id FROM role_permissions 
         WHERE role_id = $1 AND module_key = $2`,
        [primaryAdminRole.id, module.module_key]
      );

      if (existing) {
        // Update existing permission to ensure all flags are true
        await query(
          `UPDATE role_permissions 
           SET can_view = true, 
               can_add = true, 
               can_modify = true, 
               can_delete = true, 
               can_share = true,
               updated_at = CURRENT_TIMESTAMP
           WHERE role_id = $1 AND module_key = $2`,
          [primaryAdminRole.id, module.module_key]
        );
        updatedCount++;
      } else {
        // Insert new permission with all flags true
        await query(
          `INSERT INTO role_permissions (
            role_id, module_key, can_view, can_add, can_modify, can_delete, can_share
          )
          VALUES ($1, $2, true, true, true, true, true)`,
          [primaryAdminRole.id, module.module_key]
        );
        insertedCount++;
      }
    }

    return NextResponse.json({
      success: true,
      message: `Primary Admin permissions ensured for ${modules.length} modules`,
      inserted: insertedCount,
      updated: updatedCount,
      total_modules: modules.length
    });
  } catch (error: any) {
    console.error('Error ensuring Primary Admin permissions:', error);
    return NextResponse.json(
      { error: 'Failed to ensure Primary Admin permissions', details: error.message },
      { status: 500 }
    );
  }
}
