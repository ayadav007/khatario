import { NextRequest, NextResponse } from 'next/server';
import { queryOne } from '@/lib/db';
import { getUserBranches } from '@/lib/branch-access';
import { User, Business } from '@/types/database';
import { getUserIdFromRequest, assertUserSessionVersionMatches } from '@/lib/auth-helpers';
import { clearSessionCookie } from '@/lib/jwt';

/**
 * Legacy endpoint kept for backward compatibility.
 * New code should use /api/auth/session instead for fewer round-trips.
 */
export async function GET(request: NextRequest) {
  try {
    const userId = getUserIdFromRequest(request);

    if (!userId) {
      return NextResponse.json(
        { error: 'Not authenticated' },
        { status: 401 }
      );
    }

    const svCheck = await assertUserSessionVersionMatches(request, userId);
    if (!svCheck.ok) {
      const res = NextResponse.json(
        { error: 'Session revoked', code: 'SESSION_REVOKED' },
        { status: 401 }
      );
      clearSessionCookie(res);
      return res;
    }

    const user = await queryOne<User>(
      'SELECT * FROM users WHERE id = $1',
      [userId]
    );

    if (!user) {
      return NextResponse.json(
        { error: 'User not found' },
        { status: 404 }
      );
    }

    const business = await queryOne<Business>(
      'SELECT * FROM businesses WHERE id = $1',
      [user.business_id]
    );

    let userBranch = null;
    try {
      const branches = await getUserBranches(user.id);
      if (branches.length > 0) {
        const primaryBranch = branches.find(b => b.is_primary);
        userBranch = primaryBranch || branches[0];
      }
    } catch (error) {
      console.error('Error fetching user branch:', error);
    }

    const { password_hash, ...safeUser } = user;

    return NextResponse.json({
      user: safeUser,
      business,
      branch: userBranch
    });

  } catch (error: any) {
    console.error('Auth check error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

