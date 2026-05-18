import { NextRequest, NextResponse } from 'next/server';
import { query, queryOne } from '@/lib/db';
import { authorize, AuthorizationError } from '@/lib/authorization';
import bcrypt from 'bcryptjs';
import { normalizePhoneOrNull } from '@/lib/utils/phone';

/**
 * GET /api/settings/users/[id]
 * Get a single user
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const userId = params.id;

    const user = await queryOne(`
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
        ur.role_key
      FROM users u
      LEFT JOIN user_roles ur ON u.role_id = ur.id
      WHERE u.id = $1
    `, [userId]);

    if (!user) {
      return NextResponse.json(
        { error: 'User not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({ user });
  } catch (error: any) {
    console.error('Error fetching user:', error);
    return NextResponse.json(
      { error: 'Failed to fetch user', details: error.message },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/settings/users/[id]
 * Update a user
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const userId = params.id;
    const body = await request.json();
    const {
      name,
      email,
      phone,
      password,
      role_id,
      is_active,
      allow_multidevice_sync,
      updated_by_user_id
    } = body;

    // Get existing user
    const existingUser = await queryOne<{
      id: string;
      business_id: string;
      is_primary_admin: boolean;
      phone: string;
      email: string | null;
      allow_multidevice_sync: boolean | null;
    }>(
      'SELECT id, business_id, is_primary_admin, phone, email, allow_multidevice_sync FROM users WHERE id = $1',
      [userId]
    );

    if (!existingUser) {
      return NextResponse.json(
        { error: 'User not found' },
        { status: 404 }
      );
    }

    if (!updated_by_user_id) {
      return NextResponse.json(
        { error: 'updated_by_user_id is required for authorization' },
        { status: 400 }
      );
    }

    // AUTHORIZATION: Check update permission (users are part of settings)
    try {
      await authorize(updated_by_user_id, 'settings', 'update', { 
        businessId: existingUser.business_id,
        resourceId: userId
      });
    } catch (error) {
      if (error instanceof AuthorizationError) {
        return error.toNextResponse();
      }
      throw error;
    }

    // Prevent changing primary admin status
    if (existingUser.is_primary_admin && is_active === false) {
      return NextResponse.json(
        { error: 'Cannot deactivate primary admin' },
        { status: 403 }
      );
    }

    let phoneToSave: string | undefined;
    if (phone !== undefined) {
      const raw = typeof phone === 'string' ? phone : String(phone ?? '');
      const phoneNorm = normalizePhoneOrNull(raw);
      if (raw.trim() && !phoneNorm) {
        return NextResponse.json(
          { error: 'Invalid phone number' },
          { status: 400 }
        );
      }
      if (phoneNorm) {
        if (phoneNorm !== existingUser.phone) {
          const phoneExists = await queryOne(
            'SELECT id FROM users WHERE phone = $1 AND id != $2',
            [phoneNorm, userId]
          );

          if (phoneExists) {
            return NextResponse.json(
              { error: 'A user with this phone number already exists' },
              { status: 409 }
            );
          }
        }
        phoneToSave = phoneNorm;
      }
    }

    // Check if email already exists (if changing)
    if (email && email !== existingUser.email) {
      const emailExists = await queryOne(
        'SELECT id FROM users WHERE email = $1 AND id != $2',
        [email, userId]
      );

      if (emailExists) {
        return NextResponse.json(
          { error: 'A user with this email already exists' },
          { status: 409 }
        );
      }
    }

    // Build update query dynamically
    const updates: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;

    if (name !== undefined) {
      updates.push(`name = $${paramIndex++}`);
      values.push(name);
    }
    if (email !== undefined) {
      updates.push(`email = $${paramIndex++}`);
      values.push(email || null);
    }
    if (phoneToSave !== undefined) {
      updates.push(`phone = $${paramIndex++}`);
      values.push(phoneToSave);
    }
    if (password !== undefined) {
      // Hash password before storing
      const passwordHash = password ? await bcrypt.hash(password, 10) : null;
      updates.push(`password_hash = $${paramIndex++}`);
      values.push(passwordHash);
    }
    if (role_id !== undefined) {
      updates.push(`role_id = $${paramIndex++}`);
      values.push(role_id);
    }
    if (is_active !== undefined) {
      updates.push(`is_active = $${paramIndex++}`);
      values.push(is_active);
    }
    if (allow_multidevice_sync !== undefined) {
      updates.push(`allow_multidevice_sync = $${paramIndex++}`);
      values.push(allow_multidevice_sync);
    }

    const tighteningMultidevice =
      allow_multidevice_sync === false &&
      existingUser.allow_multidevice_sync === true;
    const passwordChanging = password !== undefined;
    if (passwordChanging || tighteningMultidevice) {
      updates.push(`auth_session_version = auth_session_version + 1`);
    }

    updates.push(`updated_at = CURRENT_TIMESTAMP`);

    if (updates.length === 1) { // Only updated_at
      return NextResponse.json(
        { error: 'No fields to update' },
        { status: 400 }
      );
    }

    values.push(userId);

    const updatedUser = await queryOne(`
      UPDATE users
      SET ${updates.join(', ')}
      WHERE id = $${paramIndex}
      RETURNING id, business_id, name, email, phone, role_id, is_primary_admin,
                is_active, allow_multidevice_sync, updated_at
    `, values);

    // Log activity
    if (updated_by_user_id) {
      const updater = await queryOne('SELECT name FROM users WHERE id = $1', [updated_by_user_id]);
      await query(`
        INSERT INTO user_activity_logs (
          business_id, user_id, user_name, action, module, entity_type, entity_id, details
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      `, [
        existingUser.business_id,
        updated_by_user_id,
        updater?.name || 'Unknown',
        'update_user',
        'settings',
        'user',
        userId,
        JSON.stringify({ user_name: name ?? email ?? existingUser.phone })
      ]);
    }

    return NextResponse.json({
      success: true,
      user: updatedUser,
      message: 'User updated successfully'
    });
  } catch (error: any) {
    console.error('Error updating user:', error);
    return NextResponse.json(
      { error: 'Failed to update user', details: error.message },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/settings/users/[id]
 * Delete a user
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const userId = params.id;
    const { searchParams } = new URL(request.url);
    const deletedByUserId = searchParams.get('deleted_by_user_id');

    // Get user to delete
    const user = await queryOne(
      'SELECT id, business_id, name, is_primary_admin FROM users WHERE id = $1',
      [userId]
    );

    if (!user) {
      return NextResponse.json(
        { error: 'User not found' },
        { status: 404 }
      );
    }

    // Prevent deleting primary admin
    if (user.is_primary_admin) {
      return NextResponse.json(
        { error: 'Cannot delete primary admin' },
        { status: 403 }
      );
    }

    // Delete user
    await query('DELETE FROM users WHERE id = $1', [userId]);

    // Log activity
    if (deletedByUserId) {
      const deleter = await queryOne('SELECT name FROM users WHERE id = $1', [deletedByUserId]);
      await query(`
        INSERT INTO user_activity_logs (
          business_id, user_id, user_name, action, module, entity_type, entity_id, details
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      `, [
        user.business_id,
        deletedByUserId,
        deleter?.name || 'Unknown',
        'delete_user',
        'settings',
        'user',
        userId,
        JSON.stringify({ user_name: user.name })
      ]);
    }

    return NextResponse.json({
      success: true,
      message: 'User deleted successfully'
    });
  } catch (error: any) {
    console.error('Error deleting user:', error);
    return NextResponse.json(
      { error: 'Failed to delete user', details: error.message },
      { status: 500 }
    );
  }
}

