import { NextRequest, NextResponse } from 'next/server';
import { query, queryOne } from '@/lib/db';
import { getUserIdFromRequest, assertUserSessionVersionMatches } from '@/lib/auth-helpers';
import {
  clearSessionCookie,
  signAccessToken,
  signRefreshToken,
  setSessionCookies,
} from '@/lib/jwt';
import { userBelongsToBusiness } from '@/lib/user-businesses';

export const dynamic = 'force-dynamic';

/** Same UUID shape as middleware validation for JWT business context */
const BUSINESS_UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * POST /api/businesses/switch
 * Sets active company in JWT (`businessId`) and `users.business_id`; reissues access + refresh cookies.
 */
export async function POST(request: NextRequest) {
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

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
    }

    const businessIdRaw =
      body !== null &&
      typeof body === 'object' &&
      'business_id' in body &&
      (body as { business_id?: unknown }).business_id;

    const businessId =
      typeof businessIdRaw === 'string'
        ? businessIdRaw.trim()
        : '';

    if (!businessId || !BUSINESS_UUID_RE.test(businessId)) {
      return NextResponse.json(
        { error: 'business_id must be a valid UUID' },
        { status: 400 }
      );
    }

    const allowed = await userBelongsToBusiness(userId, businessId);
    if (!allowed) {
      return NextResponse.json(
        { error: 'You do not have access to this business' },
        { status: 403 }
      );
    }

    const svRow = await queryOne<{ auth_session_version: string }>(
      `SELECT auth_session_version::text AS auth_session_version FROM users WHERE id = $1 AND is_active = true`,
      [userId]
    );
    if (!svRow) {
      const res = NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
      clearSessionCookie(res);
      return res;
    }
    const sessionVersion = Number(svRow.auth_session_version);

    await query(
      `UPDATE users u
       SET business_id = $1,
           role_id = CASE
             WHEN ub.role = 'owner' THEN COALESCE(
               (SELECT id FROM user_roles WHERE business_id = $1 AND role_key = 'primary_admin' LIMIT 1),
               u.role_id
             )
             ELSE u.role_id
           END,
           updated_at = CURRENT_TIMESTAMP
       FROM user_businesses ub
       WHERE u.id = $2 AND ub.user_id = u.id AND ub.business_id = $1`,
      [businessId, userId]
    );

    const tokenPayload = { userId, businessId, sessionVersion };
    const [accessToken, refreshToken] = await Promise.all([
      signAccessToken(tokenPayload),
      signRefreshToken(tokenPayload),
    ]);

    const response = NextResponse.json({
      success: true,
      business_id: businessId,
    });
    setSessionCookies(response, accessToken, refreshToken);
    return response;
  } catch (error: unknown) {
    console.error('POST /api/businesses/switch:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
