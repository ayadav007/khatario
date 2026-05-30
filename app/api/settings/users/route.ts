import { NextRequest, NextResponse } from 'next/server';
import { getUserIdFromRequest, getBusinessIdFromRequest, resolveCreatedByUserId } from '@/lib/auth-helpers';
import { query, queryOne, queryRows, getPool } from '@/lib/db';
import { checkLimitInTransaction } from '@/lib/subscription';
import { authorize, AuthorizationError } from '@/lib/authorization';
import bcrypt from 'bcryptjs';
import { normalizePhoneOrNull } from '@/lib/utils/phone';

/**
 * GET /api/settings/users
 * List all users for a business
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

    // AUTHORIZATION: Check read permission (users are part of settings)
    // BUT: Users can always see their own user information
    let hasSettingsRead = false;
    try {
      await authorize(userId, 'settings', 'read');
      hasSettingsRead = true;
    } catch (error) {
      if (error instanceof AuthorizationError) {
        // User doesn't have settings.read - check if they're requesting their own info
        // If requesting own user_id, allow limited access
        const requestedUserId = searchParams.get('requested_user_id') || userId;
        if (requestedUserId !== userId) {
          // Requesting someone else's info without settings.read - deny
          return error.toNextResponse();
        }
        // Requesting own info - continue with limited query
      } else {
        throw error;
      }
    }

    // Build query based on permissions
    let whereClause = 'WHERE u.business_id = $1';
    const queryParams: any[] = [businessId];
    
    if (!hasSettingsRead) {
      // User doesn't have settings.read - only return their own user info
      whereClause += ' AND u.id = $2';
      queryParams.push(userId);
    }

    const users = await queryRows(`
      SELECT 
        u.id,
        u.business_id,
        u.name,
        u.email,
        u.phone,
        u.role,
        u.is_primary_admin,
        u.is_active,
        u.allow_multidevice_sync,
        u.last_active_at,
        u.created_at,
        ur.id as role_id,
        ur.role_name,
        ur.role_key,
        e.id as employee_id,
        e.employee_code,
        e.designation,
        e.department,
        e.access_type,
        CASE 
          WHEN u.is_primary_admin = true AND ur.role_key = 'primary_admin' THEN 'Primary Admin'
          WHEN ur.role_name IS NOT NULL THEN ur.role_name
          WHEN u.is_primary_admin = true THEN 'Primary Admin (No Role)'
          ELSE 'No Role'
        END as display_role
      FROM users u
      LEFT JOIN user_roles ur ON u.role_id = ur.id
      LEFT JOIN employees e ON u.id = e.id
      ${whereClause}
      ORDER BY u.is_primary_admin DESC, u.created_at ASC
    `, queryParams);

    return NextResponse.json({ users });
  } catch (error: any) {
    console.error('Error fetching users:', error);
    return NextResponse.json(
      { error: 'Failed to fetch users', details: error.message },
      { status: 500 }
    );
  }
}

/**
 * POST /api/settings/users
 * Create a new user
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      business_id,
      name,
      email,
      phone,
      password,
      role_id,
      branch_id, // Optional: branch to assign user to
      allow_multidevice_sync,
    } = body;
    const createdByUserId = resolveCreatedByUserId(request, body);

    // Validation
    if (!business_id || !name || !phone || !password || !role_id) {
      return NextResponse.json(
        { error: 'business_id, name, phone, password, and role_id are required' },
        { status: 400 }
      );
    }

    if (!createdByUserId) {
      return NextResponse.json(
        { error: 'created_by_user_id is required for authorization' },
        { status: 400 }
      );
    }

    const phoneNorm = normalizePhoneOrNull(phone);
    if (!phoneNorm) {
      return NextResponse.json(
        { error: 'Invalid phone number' },
        { status: 400 }
      );
    }

    // AUTHORIZATION: Check create permission (users are part of settings)
    try {
      await authorize(createdByUserId, 'settings', 'create');
    } catch (error) {
      if (error instanceof AuthorizationError) {
        return error.toNextResponse();
      }
      throw error;
    }

    const existingUser = await queryOne(
      'SELECT id FROM users WHERE phone = $1',
      [phoneNorm]
    );

    if (existingUser) {
      return NextResponse.json(
        { error: 'A user with this phone number already exists' },
        { status: 409 }
      );
    }

    if (email) {
      const existingEmail = await queryOne(
        'SELECT id FROM users WHERE email = $1',
        [email]
      );

      if (existingEmail) {
        return NextResponse.json(
          { error: 'A user with this email already exists' },
          { status: 409 }
        );
      }
    }

    const role = await queryOne(
      'SELECT id, role_key FROM user_roles WHERE id = $1 AND business_id = $2',
      [role_id, business_id]
    );

    if (!role) {
      return NextResponse.json(
        { error: 'Invalid role_id for this business' },
        { status: 400 }
      );
    }

    const settings = await queryOne(
      'SELECT user_management_enabled FROM business_settings WHERE business_id = $1',
      [business_id]
    );

    if (!settings?.user_management_enabled && role.role_key !== 'primary_admin') {
      return NextResponse.json(
        { error: 'User management is not enabled for this business' },
        { status: 403 }
      );
    }

    const pool = getPool();
    const client = await pool.connect();
    let newUser: {
      id: string;
      business_id: string;
      name: string;
      email: string | null;
      phone: string;
      role_id: string;
      is_primary_admin: boolean;
      allow_multidevice_sync: boolean;
      is_active: boolean;
      created_at: string;
    } | null = null;

    try {
      await client.query('BEGIN');

      const limitCheck = await checkLimitInTransaction(client, business_id, 'users');
      if (!limitCheck.allowed) {
        await client.query('ROLLBACK');
        return NextResponse.json(
          {
            error: limitCheck.message || 'User limit reached',
            limit: limitCheck.limit,
            current: limitCheck.current,
            code: 'SUBSCRIPTION_LIMIT_EXCEEDED',
          },
          { status: 403 },
        );
      }

      const passwordHash = password ? await bcrypt.hash(password, 10) : null;
      const insertResult = await client.query(`
        INSERT INTO users (
          business_id, name, email, phone, password_hash, role_id,
          is_primary_admin, allow_multidevice_sync, is_active
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, true)
        RETURNING id, business_id, name, email, phone, role_id, is_primary_admin,
                  allow_multidevice_sync, is_active, created_at
      `, [
        business_id,
        name,
        email || null,
        phoneNorm,
        passwordHash,
        role_id,
        role.role_key === 'primary_admin',
        allow_multidevice_sync || false,
      ]);

      newUser = insertResult.rows[0] ?? null;
      if (!newUser) {
        await client.query('ROLLBACK');
        return NextResponse.json(
          { error: 'Failed to create user' },
          { status: 500 },
        );
      }

      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      throw e;
    } finally {
      client.release();
    }

    if (!newUser) {
      return NextResponse.json(
        { error: 'Failed to create user' },
        { status: 500 },
      );
    }

    // Assign user to branch
    if (branch_id) {
      // Validate branch belongs to business
      const branch = await queryOne<{ id: string; business_id: string }>(
        'SELECT id, business_id FROM branches WHERE id = $1 AND business_id = $2 AND is_active = true',
        [branch_id, business_id]
      );

      if (!branch) {
        return NextResponse.json(
          { error: 'Invalid branch_id or branch does not belong to this business' },
          { status: 400 }
        );
      }

      // Assign user to selected branch with full permissions
      await query(`
        INSERT INTO user_branches (
          user_id, branch_id, can_view, can_edit, can_delete, can_create_transactions
        )
        VALUES ($1, $2, true, true, true, true)
        ON CONFLICT (user_id, branch_id) DO NOTHING
      `, [newUser.id, branch_id]);
    } else {
      // If no branch specified, assign to default branch (existing behavior)
      const { ensureUserHasDefaultBranchAccess } = await import('@/lib/branch-access');
      await ensureUserHasDefaultBranchAccess(newUser.id);
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
        'create_user',
        'settings',
        'user',
        newUser.id,
        JSON.stringify({ user_name: name, user_phone: phoneNorm })
      ]);
    }

    return NextResponse.json({
      success: true,
      user: newUser,
      message: 'User created successfully'
    });
  } catch (error: any) {
    console.error('Error creating user:', error);
    return NextResponse.json(
      { error: 'Failed to create user', details: error.message },
      { status: 500 }
    );
  }
}

