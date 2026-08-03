import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { getEmployeePortalSessionFromRequest } from '@/lib/employee-portal/session';
import {
  validateEmployeePortalPassword,
  updateEmployeePortalPassword,
  clearMustChangePassword,
} from '@/lib/employee-portal/password';
import { queryOne } from '@/lib/db';

export const dynamic = 'force-dynamic';

/**
 * POST /api/public/employee/session/change-password
 * Change password while logged into the employee portal.
 */
export async function POST(request: NextRequest) {
  try {
    const session = await getEmployeePortalSessionFromRequest(request);
    if (!session) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    const body = await request.json();
    const currentPassword = String(body.current_password ?? '');
    const newPassword = String(body.new_password ?? '');

    const validation = validateEmployeePortalPassword(newPassword);
    if (!validation.ok) {
      return NextResponse.json({ error: validation.error }, { status: 400 });
    }

    const user = await queryOne<{ password_hash: string | null; must_change_password: boolean }>(
      `SELECT u.password_hash, u.must_change_password
       FROM users u
       INNER JOIN employees e ON e.id = u.id
       WHERE u.id = $1 AND e.business_id = $2`,
      [session.employee_id, session.business_id]
    );

    if (!user?.password_hash) {
      return NextResponse.json({ error: 'Account not configured for password login' }, { status: 400 });
    }

    if (!user.must_change_password) {
      if (!currentPassword) {
        return NextResponse.json({ error: 'Current password is required' }, { status: 400 });
      }
      const valid = await bcrypt.compare(currentPassword, user.password_hash);
      if (!valid) {
        return NextResponse.json({ error: 'Current password is incorrect' }, { status: 400 });
      }
      if (await bcrypt.compare(newPassword, user.password_hash)) {
        return NextResponse.json(
          { error: 'New password must be different from your current password' },
          { status: 400 }
        );
      }
    }

    await updateEmployeePortalPassword(session.employee_id, session.business_id, newPassword, {
      mustChange: false,
    });
    await clearMustChangePassword(session.employee_id, session.business_id);

    return NextResponse.json({ ok: true, message: 'Password updated successfully' });
  } catch (error: unknown) {
    console.error('[employee portal change-password]', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to change password' },
      { status: 500 }
    );
  }
}
