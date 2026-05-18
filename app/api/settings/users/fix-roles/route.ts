import { NextRequest, NextResponse } from 'next/server';
import { query, queryOne, queryRows } from '@/lib/db';

/**
 * POST /api/settings/users/fix-roles
 * Fix users without roles assigned - assigns Primary Admin role to primary admins
 * This is a one-time fix for existing users created before role system was implemented
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { business_id } = body;

    if (!business_id) {
      return NextResponse.json(
        { error: 'business_id is required' },
        { status: 400 }
      );
    }

    // Get all users without roles for this business
    const usersWithoutRoles = await queryRows(`
      SELECT id, name, is_primary_admin
      FROM users
      WHERE business_id = $1 AND role_id IS NULL
    `, [business_id]);

    if (usersWithoutRoles.length === 0) {
      return NextResponse.json({
        success: true,
        message: 'All users already have roles assigned',
        fixed: 0
      });
    }

    // Ensure roles exist for this business
    let primaryAdminRoleId: string | null = null;
    const existingRole = await queryOne(`
      SELECT id FROM user_roles 
      WHERE business_id = $1 AND role_key = 'primary_admin'
    `, [business_id]);

    if (existingRole) {
      primaryAdminRoleId = existingRole.id;
    } else {
      // Initialize roles for this business if they don't exist
      // This will be done via the initialize API logic
      const initResponse = await fetch(`${request.nextUrl.origin}/api/settings/roles/initialize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ business_id })
      });

      if (!initResponse.ok) {
        return NextResponse.json(
          { error: 'Failed to initialize roles for business' },
          { status: 500 }
        );
      }

      // Get the Primary Admin role ID after initialization
      const role = await queryOne(`
        SELECT id FROM user_roles 
        WHERE business_id = $1 AND role_key = 'primary_admin'
      `, [business_id]);
      
      if (!role) {
        return NextResponse.json(
          { error: 'Failed to create Primary Admin role' },
          { status: 500 }
        );
      }
      primaryAdminRoleId = role.id;
    }

    // Assign Primary Admin role to all primary admins without roles
    let fixedCount = 0;
    for (const user of usersWithoutRoles) {
      if (user.is_primary_admin) {
        await query(`
          UPDATE users 
          SET role_id = $1 
          WHERE id = $2 AND role_id IS NULL
        `, [primaryAdminRoleId, user.id]);
        fixedCount++;
      }
    }

    return NextResponse.json({
      success: true,
      message: `Fixed ${fixedCount} user(s) by assigning Primary Admin role`,
      fixed: fixedCount,
      users_fixed: usersWithoutRoles.filter((u: any) => u.is_primary_admin).map((u: any) => u.name)
    });
  } catch (error: any) {
    console.error('Error fixing user roles:', error);
    return NextResponse.json(
      { error: 'Failed to fix user roles', details: error.message },
      { status: 500 }
    );
  }
}

