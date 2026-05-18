import { NextRequest, NextResponse } from 'next/server';
import { consumeImpersonationToken } from '@/lib/admin-business-ops';
import { signAccessToken, signRefreshToken, setSessionCookies } from '@/lib/jwt';
import { queryOne } from '@/lib/db';

export const dynamic = 'force-dynamic';

/**
 * POST /api/auth/impersonate/consume
 * One-time exchange of platform admin impersonation token for tenant session cookies.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const token = typeof body.token === 'string' ? body.token.trim() : '';
    if (!token) {
      return NextResponse.json({ error: 'token is required' }, { status: 400 });
    }

    const session = await consumeImpersonationToken(token);
    if (!session) {
      return NextResponse.json({ error: 'Invalid or expired token' }, { status: 401 });
    }

    const user = await queryOne<{ id: string; business_id: string; name: string }>(
      `SELECT id, business_id, name FROM users WHERE id = $1 AND is_active = true`,
      [session.userId],
    );
    if (!user) {
      return NextResponse.json({ error: 'User unavailable' }, { status: 401 });
    }

    const [accessToken, refreshToken] = await Promise.all([
      signAccessToken({
        userId: session.userId,
        businessId: session.businessId,
        sessionVersion: session.sessionVersion,
      }),
      signRefreshToken({
        userId: session.userId,
        businessId: session.businessId,
        sessionVersion: session.sessionVersion,
      }),
    ]);

    const response = NextResponse.json({
      success: true,
      redirect: '/dashboard',
      impersonating: true,
      user_name: user.name,
    });

    setSessionCookies(response, accessToken, refreshToken);
    return response;
  } catch (error: unknown) {
    console.error('[impersonate/consume]', error);
    return NextResponse.json({ error: 'Failed to start session' }, { status: 500 });
  }
}
