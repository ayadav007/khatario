import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { authenticatePlatformAdmin, logAdminAction } from '@/lib/platform-auth';
import {
  signPlatformAccessToken,
  setPlatformSessionCookie,
  PLATFORM_ACCESS_COOKIE,
} from '@/lib/platform-jwt';
import { checkRateLimit, getClientIp } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

const ADMIN_LOGIN_LIMIT = 10;
const ADMIN_LOGIN_WINDOW_MS = 15 * 60 * 1000;

/**
 * POST /api/admin/auth/login
 * Platform admin authentication (separate from business users)
 */
export async function POST(request: NextRequest) {
  try {
    const ip = getClientIp(request);
    const rl = checkRateLimit(`admin-login:${ip}`, ADMIN_LOGIN_LIMIT, ADMIN_LOGIN_WINDOW_MS);
    if (!rl.allowed) {
      return NextResponse.json(
        { error: 'Too many login attempts. Please try again later.', retryAfterMs: rl.retryAfterMs },
        { status: 429 }
      );
    }

    const body = await request.json();
    const { email, password } = body;

    if (!email || !password) {
      return NextResponse.json(
        { error: 'Email and password are required' },
        { status: 400 }
      );
    }

    const result = await authenticatePlatformAdmin(email, password);

    if (!result) {
      return NextResponse.json(
        { error: 'Invalid credentials or account inactive' },
        { status: 401 }
      );
    }

    const { admin, sessionVersion } = result;

    const ipAddress =
      request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || 'unknown';
    const userAgent = request.headers.get('user-agent') || 'unknown';

    await logAdminAction(
      admin.id,
      'login',
      undefined,
      undefined,
      { email: admin.email },
      ipAddress,
      userAgent
    );

    const token = await signPlatformAccessToken({
      adminId: admin.id,
      sessionVersion,
    });

    const response = NextResponse.json({
      success: true,
      admin: {
        id: admin.id,
        name: admin.name,
        email: admin.email,
        role: admin.role,
        permissions: admin.permissions,
      },
      redirect: '/admin',
    });

    setPlatformSessionCookie(response, token);
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || '';
    const secure = process.env.NODE_ENV === 'production' && appUrl.startsWith('https://');
    cookies().set(PLATFORM_ACCESS_COOKIE, token, {
      httpOnly: true,
      secure,
      sameSite: 'lax',
      path: '/',
      maxAge: 24 * 60 * 60,
    });

    return response;
  } catch (error: any) {
    console.error('Platform admin login error:', error);
    return NextResponse.json(
      { error: 'Login failed', details: error.message },
      { status: 500 }
    );
  }
}
