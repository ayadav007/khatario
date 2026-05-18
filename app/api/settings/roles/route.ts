import { NextRequest, NextResponse } from 'next/server';
import { getUserIdFromRequest, getBusinessIdFromRequest, resolveCreatedByUserId } from '@/lib/auth-helpers';
import { query, queryRows, queryOne } from '@/lib/db';
import { authorize, AuthorizationError } from '@/lib/authorization';

/**
 * GET /api/settings/roles
 * List all roles for a business with their permissions
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const businessId = getBusinessIdFromRequest(request);
    const userId = getUserIdFromRequest(request); // REQUIRED for authorization

    if (!businessId) {
      return NextResponse.json(
        { error: 'business_id is required' },
        { status: 400 }
      );
    }

    if (!userId) {
      return NextResponse.json(
        { error: 'user_id is required for authorization' },
        { status: 400 }
      );
    }

    // AUTHORIZATION: Check read permission (roles are part of settings)
    try {
      await authorize(userId, 'settings', 'read');
    } catch (error) {
      if (error instanceof AuthorizationError) {
        return error.toNextResponse();
      }
      throw error;
    }

    // Get roles
    const roles = await queryRows(`
      SELECT 
        id,
        business_id,
        role_name,
        role_key,
        description,
        is_system_role,
        is_active,
        created_at
      FROM user_roles
      WHERE business_id = $1
      ORDER BY 
        CASE role_key
          WHEN 'primary_admin' THEN 1
          WHEN 'sales' THEN 2
          WHEN 'accountant' THEN 3
          WHEN 'inventory_manager' THEN 4
          ELSE 5
        END,
        role_name ASC
    `, [businessId]);

    // Get permissions for each role
    for (const role of roles) {
      const permissions = await queryRows(`
        SELECT 
          rp.module_key,
          pm.module_name,
          pm.description as module_description,
          rp.can_view,
          rp.can_add,
          rp.can_modify,
          rp.can_delete,
          rp.can_share
        FROM role_permissions rp
        INNER JOIN permission_modules pm ON rp.module_key = pm.module_key
        WHERE rp.role_id = $1
        ORDER BY pm.display_order ASC
      `, [role.id]);

      role.permissions = permissions;
    }

    return NextResponse.json({ roles });
  } catch (error: any) {
    console.error('Error fetching roles:', error);
    return NextResponse.json(
      { error: 'Failed to fetch roles', details: error.message },
      { status: 500 }
    );
  }
}

/**
 * POST /api/settings/roles
 * Create a custom role
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      business_id,
      role_name,
      description,
      permissions, // Array of { module_key, can_view, can_add, can_modify, can_delete, can_share }
    } = body;
    const createdByUserId = resolveCreatedByUserId(request, body);

    // Validation
    if (!business_id || !role_name) {
      return NextResponse.json(
        { error: 'business_id and role_name are required' },
        { status: 400 }
      );
    }

    if (!createdByUserId) {
      return NextResponse.json(
        { error: 'created_by_user_id is required for authorization' },
        { status: 400 }
      );
    }

    // AUTHORIZATION: Check create permission (roles are part of settings)
    try {
      await authorize(createdByUserId, 'settings', 'create');
    } catch (error) {
      if (error instanceof AuthorizationError) {
        return error.toNextResponse();
      }
      throw error;
    }

    // Generate role_key from role_name (lowercase, replace spaces with underscores)
    const role_key = role_name.toLowerCase().replace(/\s+/g, '_') + '_custom';

    // Debug: Log what we're checking
    console.log(`[Role Create] Checking for duplicates - business_id: ${business_id}, role_name: ${role_name}, role_key: ${role_key}`);

    // Check if role_key or role_name already exists (including inactive roles)
    const existingRole = await queryOne(
      `SELECT id, role_name, role_key, is_active, business_id
       FROM user_roles 
       WHERE business_id = $1 
       AND (role_key = $2 OR LOWER(TRIM(role_name)) = LOWER(TRIM($3)))`,
      [business_id, role_key, role_name]
    );

    if (existingRole) {
      console.log(`[Role Create] Found existing role:`, existingRole);
      // Provide more helpful error message
      if (!existingRole.is_active) {
        return NextResponse.json(
          { 
            error: `A role with this name already exists but is inactive. Please use a different name or reactivate the existing role.`,
            existingRoleId: existingRole.id,
            existingRoleName: existingRole.role_name,
            isInactive: true
          },
          { status: 409 }
        );
      }
      return NextResponse.json(
        { 
          error: `A role with this name already exists. Please use a different name.`,
          existingRoleId: existingRole.id,
          existingRoleName: existingRole.role_name
        },
        { status: 409 }
      );
    }

    // Double-check: Also verify no roles exist at all (for debugging)
    const allRoles = await queryRows(
      `SELECT id, role_name, role_key, is_active FROM user_roles WHERE business_id = $1`,
      [business_id]
    );
    console.log(`[Role Create] Total roles for business ${business_id}:`, allRoles.length, allRoles.map(r => ({ name: r.role_name, key: r.role_key, active: r.is_active })));

    // Create role
    const newRole = await queryOne(`
      INSERT INTO user_roles (business_id, role_name, role_key, description, is_system_role, is_active)
      VALUES ($1, $2, $3, $4, false, true)
      RETURNING id, business_id, role_name, role_key, description, is_system_role, is_active, created_at
    `, [business_id, role_name, role_key, description || null]);

    // Create permissions
    if (permissions && Array.isArray(permissions)) {
      for (const perm of permissions) {
        await query(`
          INSERT INTO role_permissions (
            role_id, module_key, can_view, can_add, can_modify, can_delete, can_share
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7)
        `, [
          newRole.id,
          perm.module_key,
          perm.can_view || false,
          perm.can_add || false,
          perm.can_modify || false,
          perm.can_delete || false,
          perm.can_share || false
        ]);
      }
    } else {
      // Create default permissions (view only for all modules)
      const modules = await queryRows('SELECT module_key FROM permission_modules WHERE is_active = true');
      for (const module of modules) {
        await query(`
          INSERT INTO role_permissions (role_id, module_key, can_view, can_add, can_modify, can_delete, can_share)
          VALUES ($1, $2, true, false, false, false, false)
        `, [newRole.id, module.module_key]);
      }
    }

    // Log activity
    if (createdByUserId) {
      const creator = await queryOne('SELECT name FROM users WHERE id = $1', [createdByUserId]);
      await query(`
        INSERT INTO user_activity_logs (
          business_id, user_id, user_name, action, module, entity_type, entity_id, details
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      `, [
        business_id,
        createdByUserId,
        creator?.name || 'Unknown',
        'create_role',
        'settings',
        'role',
        newRole.id,
        JSON.stringify({ role_name })
      ]);
    }

    return NextResponse.json({
      success: true,
      role: newRole,
      message: 'Role created successfully'
    });
  } catch (error: any) {
    console.error('Error creating role:', error);
    return NextResponse.json(
      { error: 'Failed to create role', details: error.message },
      { status: 500 }
    );
  }
}

