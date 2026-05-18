import { NextRequest, NextResponse } from 'next/server';
import { getUserIdFromRequest, assertUserSessionVersionMatches } from '@/lib/auth-helpers';
import { clearSessionCookie } from '@/lib/jwt';
import { listUserBusinessMemberships } from '@/lib/user-businesses';

/**
 * GET /api/businesses/my
 * All businesses the current user belongs to (from user_businesses), with name and role.
 */
export async function GET(request: NextRequest) {
  try {
    const userId = getUserIdFromRequest(request);

    if (!userId) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
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

    const businesses = await listUserBusinessMemberships(userId);
    return NextResponse.json({ businesses });
  } catch (error: unknown) {
    console.error('GET /api/businesses/my:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
