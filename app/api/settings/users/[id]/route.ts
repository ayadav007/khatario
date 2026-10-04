import { NextRequest, NextResponse } from 'next/server';
import { getPool, query, queryOne } from '@/lib/db';
import { authorize, AuthorizationError } from '@/lib/authorization';
import { requireStrictSession } from '@/lib/auth-helpers';
import bcrypt from 'bcryptjs';
import { normalizePhoneOrNull } from '@/lib/utils/phone';
import { checkLimit, hasWhatsAppBotAddon } from '@/lib/subscription';
import {
  checkRoleForConnectSeat,
  connectSeatRoleMessage,
  ensureWhatsAppAgentRole,
  isSeatType,
  seatLimitMessage,
  seatLimitType,
  type SeatType,
} from '@/lib/users/connect-seats';

export const dynamic = 'force-dynamic';

async function isPrimaryAdminActor(actorId: string, businessId: string): Promise<boolean> {
  const actor = await queryOne<{ is_primary_admin: boolean }>(
    'SELECT is_primary_admin FROM users WHERE id = $1 AND business_id = $2',
    [actorId, businessId]
  );
  return actor?.is_primary_admin === true;
}

/**
 * GET /api/settings/users/[id]
 * Get a user in the session business. Users may read themselves; anyone else needs settings:read.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await requireStrictSession(request);
  if (!session.ok) return session.response;
  const { userId: actorId, businessId } = session;

  try {
    const userId = params.id;

    if (userId !== actorId) {
      try {
        await authorize(actorId, 'settings', 'read', { businessId, resourceId: userId });
      } catch (error) {
        if (error instanceof AuthorizationError) return error.toNextResponse();
        throw error;
      }
    }

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
        COALESCE(u.seat_type, 'billing') AS seat_type,
        ur.id as role_id,
        ur.role_name,
        ur.role_key
      FROM users u
      LEFT JOIN user_roles ur ON u.role_id = ur.id
      WHERE u.id = $1 AND u.business_id = $2
    `, [userId, businessId]);

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
 * Update a user in the session business (settings:update). Body `updated_by_user_id` is ignored.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await requireStrictSession(request);
  if (!session.ok) return session.response;
  const { userId: updated_by_user_id, businessId } = session;

  try {
    const userId = params.id;
    const body = await request.json();
    const {
      name,
      email,
      phone,
      password,
      is_active,
      allow_multidevice_sync,
      seat_type,
    } = body;
    let { role_id } = body;

    if (seat_type !== undefined && !isSeatType(seat_type)) {
      return NextResponse.json({ error: "seat_type must be 'billing' or 'connect'" }, { status: 400 });
    }

    const existingUser = await queryOne<{
      id: string;
      business_id: string;
      is_primary_admin: boolean;
      phone: string;
      email: string | null;
      allow_multidevice_sync: boolean | null;
      is_active: boolean | null;
      role_id: string | null;
      seat_type: SeatType | null;
    }>(
      `SELECT id, business_id, is_primary_admin, phone, email, allow_multidevice_sync, is_active,
              role_id, seat_type
         FROM users WHERE id = $1 AND business_id = $2`,
      [userId, businessId]
    );

    if (!existingUser) {
      return NextResponse.json(
        { error: 'User not found' },
        { status: 404 }
      );
    }

    try {
      await authorize(updated_by_user_id, 'settings', 'update', {
        businessId,
        resourceId: userId
      });
    } catch (error) {
      if (error instanceof AuthorizationError) {
        return error.toNextResponse();
      }
      throw error;
    }

    const actorIsPrimaryAdmin = await isPrimaryAdminActor(updated_by_user_id, businessId);

    if (existingUser.is_primary_admin && !actorIsPrimaryAdmin) {
      return NextResponse.json(
        { error: 'Only the primary admin can change the primary admin account', code: 'PRIMARY_ADMIN_PROTECTED' },
        { status: 403 }
      );
    }

    // Prevent changing primary admin status
    if (existingUser.is_primary_admin && is_active === false) {
      return NextResponse.json(
        { error: 'Cannot deactivate primary admin' },
        { status: 403 }
      );
    }

    const currentSeat: SeatType = existingUser.seat_type ?? 'billing';
    const targetSeat: SeatType = seat_type ?? currentSeat;
    const movingSeat = targetSeat !== currentSeat;

    if (movingSeat && existingUser.is_primary_admin) {
      return NextResponse.json(
        { error: 'The primary admin always uses a Billing seat', code: 'PRIMARY_ADMIN_PROTECTED' },
        { status: 403 }
      );
    }

    if (movingSeat && targetSeat === 'connect' && !(await hasWhatsAppBotAddon(businessId))) {
      return NextResponse.json(
        {
          error: 'WhatsApp agents need an active Connect plan. Buy or renew Connect from Settings → Products.',
          code: 'WHATSAPP_BOT_ADDON_REQUIRED',
        },
        { status: 403 }
      );
    }

    if (targetSeat === 'connect') {
      const roleToCheck = role_id !== undefined ? role_id : movingSeat ? existingUser.role_id : null;
      if (roleToCheck) {
        const check = await checkRoleForConnectSeat(getPool(), roleToCheck, businessId);
        if (!check.ok) {
          if (role_id !== undefined) {
            return NextResponse.json(
              { error: connectSeatRoleMessage(check), code: 'ROLE_EXCEEDS_CONNECT_SEAT', permissions: check.violations },
              { status: 400 }
            );
          }
          // Moving to Connect with a Billing role: switch to the WhatsApp Agent role.
          role_id = await ensureWhatsAppAgentRole(getPool(), businessId);
        }
      } else if (movingSeat) {
        role_id = await ensureWhatsAppAgentRole(getPool(), businessId);
      }
    }

    const willBeActive = is_active !== undefined ? is_active === true : existingUser.is_active !== false;
    const reactivating = is_active === true && existingUser.is_active === false;
    if (willBeActive && (movingSeat || reactivating)) {
      const limitCheck = await checkLimit(businessId, seatLimitType(targetSeat));
      if (!limitCheck.allowed) {
        return NextResponse.json(
          {
            error: seatLimitMessage(targetSeat, limitCheck),
            limit: limitCheck.limit,
            current: limitCheck.current,
            seat_type: targetSeat,
            code: 'SUBSCRIPTION_LIMIT_EXCEEDED',
          },
          { status: 403 },
        );
      }
    }

    if (role_id !== undefined) {
      const role = role_id
        ? await queryOne<{ role_key: string }>(
            'SELECT role_key FROM user_roles WHERE id = $1 AND business_id = $2 AND is_active = true',
            [role_id, businessId]
          )
        : null;
      if (!role) {
        return NextResponse.json(
          { error: 'Invalid role_id for this business' },
          { status: 400 }
        );
      }
      if (role.role_key === 'primary_admin' && !actorIsPrimaryAdmin) {
        return NextResponse.json(
          { error: 'Only the primary admin can assign the Primary Admin role', code: 'PRIMARY_ADMIN_ROLE_PROTECTED' },
          { status: 403 }
        );
      }
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
    if (movingSeat) {
      updates.push(`seat_type = $${paramIndex++}`);
      values.push(targetSeat);
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

    values.push(userId, businessId);

    const updatedUser = await queryOne(`
      UPDATE users
      SET ${updates.join(', ')}
      WHERE id = $${paramIndex} AND business_id = $${paramIndex + 1}
      RETURNING id, business_id, name, email, phone, role_id, is_primary_admin,
                is_active, allow_multidevice_sync, seat_type, updated_at
    `, values);

    const updater = await queryOne('SELECT name FROM users WHERE id = $1', [updated_by_user_id]);
    await query(`
      INSERT INTO user_activity_logs (
        business_id, user_id, user_name, action, module, entity_type, entity_id, details
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    `, [
      businessId,
      updated_by_user_id,
      updater?.name || 'Unknown',
      'update_user',
      'settings',
      'user',
      userId,
      JSON.stringify({
        user_name: name ?? email ?? existingUser.phone,
        ...(movingSeat ? { seat_type: { from: currentSeat, to: targetSeat } } : {}),
      })
    ]);

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
 * Delete a user in the session business (settings:delete). `deleted_by_user_id` is ignored.
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await requireStrictSession(request);
  if (!session.ok) return session.response;
  const { userId: deletedByUserId, businessId } = session;

  try {
    const userId = params.id;

    const user = await queryOne<{ id: string; business_id: string; name: string; is_primary_admin: boolean }>(
      'SELECT id, business_id, name, is_primary_admin FROM users WHERE id = $1 AND business_id = $2',
      [userId, businessId]
    );

    if (!user) {
      return NextResponse.json(
        { error: 'User not found' },
        { status: 404 }
      );
    }

    try {
      await authorize(deletedByUserId, 'settings', 'delete', { businessId, resourceId: userId });
    } catch (error) {
      if (error instanceof AuthorizationError) return error.toNextResponse();
      throw error;
    }

    if (userId === deletedByUserId) {
      return NextResponse.json(
        { error: 'You cannot delete your own account', code: 'SELF_DELETE_FORBIDDEN' },
        { status: 403 }
      );
    }

    if (user.is_primary_admin) {
      return NextResponse.json(
        { error: 'Cannot delete primary admin' },
        { status: 403 }
      );
    }

    await query('DELETE FROM users WHERE id = $1 AND business_id = $2', [userId, businessId]);

    const deleter = await queryOne('SELECT name FROM users WHERE id = $1', [deletedByUserId]);
    await query(`
      INSERT INTO user_activity_logs (
        business_id, user_id, user_name, action, module, entity_type, entity_id, details
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    `, [
      businessId,
      deletedByUserId,
      deleter?.name || 'Unknown',
      'delete_user',
      'settings',
      'user',
      userId,
      JSON.stringify({ user_name: user.name })
    ]);

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

