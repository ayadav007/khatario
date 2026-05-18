import { NextRequest, NextResponse } from 'next/server';
import { query, queryOne } from '@/lib/db';

/**
 * POST /api/debug/fix-user
 * Fix a user's database state to ensure they have primary admin role and permissions
 * This is a diagnostic/fix endpoint for users who should be primary admin but aren't working
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { user_id, phone, business_id } = body;

    if (!user_id && !phone) {
      return NextResponse.json(
        { error: 'user_id or phone is required' },
        { status: 400 }
      );
    }

    // Find user
    let user: any = null;
    if (user_id) {
      user = await queryOne(
        'SELECT id, name, phone, business_id, role_id, is_primary_admin FROM users WHERE id = $1',
        [user_id]
      );
    } else if (phone) {
      user = await queryOne(
        'SELECT id, name, phone, business_id, role_id, is_primary_admin FROM users WHERE phone = $1',
        [phone]
      );
    }

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    const actualBusinessId = business_id || user.business_id;
    if (!actualBusinessId) {
      return NextResponse.json({ error: 'Business ID not found' }, { status: 400 });
    }

    const fixes: string[] = [];

    // Fix 1: Ensure is_primary_admin is true
    if (!user.is_primary_admin) {
      await query(
        'UPDATE users SET is_primary_admin = true WHERE id = $1',
        [user.id]
      );
      fixes.push('Set is_primary_admin = true');
    }

    // Fix 2: Ensure primary_admin role exists for business
    let primaryAdminRole = await queryOne(
      'SELECT id FROM user_roles WHERE business_id = $1 AND role_key = $2',
      [actualBusinessId, 'primary_admin']
    );

    if (!primaryAdminRole) {
      // Create primary admin role
      const roleResult = await queryOne(
        `INSERT INTO user_roles (business_id, role_name, role_key, description, is_system_role)
         VALUES ($1, 'Primary Admin', 'primary_admin', 'Full access to all features', true)
         RETURNING id`,
        [actualBusinessId]
      );
      primaryAdminRole = { id: roleResult.id };
      fixes.push('Created primary_admin role');
    }

    // Fix 3: Ensure all permissions are set for primary_admin role
    const modules = await queryOne(
      'SELECT COUNT(*) as count FROM permission_modules WHERE is_active = true'
    );
    const moduleCount = parseInt(modules?.count || '0', 10);

    const existingPerms = await queryOne(
      'SELECT COUNT(*) as count FROM role_permissions WHERE role_id = $1',
      [primaryAdminRole.id]
    );
    const permCount = parseInt(existingPerms?.count || '0', 10);

    if (permCount < moduleCount) {
      // Set all permissions for primary admin role
      await query(
        `INSERT INTO role_permissions (role_id, module_key, can_view, can_add, can_modify, can_delete, can_share)
         SELECT $1, module_key, true, true, true, true, true
         FROM permission_modules
         WHERE is_active = true
         ON CONFLICT (role_id, module_key) DO UPDATE
         SET can_view = true, can_add = true, can_modify = true, can_delete = true, can_share = true`,
        [primaryAdminRole.id]
      );
      fixes.push(`Set all permissions for primary_admin role (${moduleCount} modules)`);
    }

    // Fix 4: Assign role_id to user if missing
    if (!user.role_id || user.role_id !== primaryAdminRole.id) {
      await query(
        'UPDATE users SET role_id = $1 WHERE id = $2',
        [primaryAdminRole.id, user.id]
      );
      fixes.push('Assigned primary_admin role_id to user');
    }

    // Verify final state
    const finalUser = await queryOne(
      'SELECT id, name, phone, business_id, role_id, is_primary_admin FROM users WHERE id = $1',
      [user.id]
    );

    const finalRole = await queryOne(
      'SELECT id, role_name, role_key FROM user_roles WHERE id = $1',
      [finalUser.role_id]
    );

    const dashboardPerm = await queryOne(
      'SELECT can_view FROM role_permissions WHERE role_id = $1 AND module_key = $2',
      [finalUser.role_id, 'dashboard']
    );

    return NextResponse.json({
      success: true,
      fixes,
      finalState: {
        user: finalUser,
        role: finalRole,
        hasDashboardRead: dashboardPerm?.can_view === true,
      },
    });
  } catch (error: any) {
    console.error('Fix user error:', error);
    return NextResponse.json(
      { error: error.message },
      { status: 500 }
    );
  }
}
