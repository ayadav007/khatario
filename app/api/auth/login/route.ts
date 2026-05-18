import { NextRequest, NextResponse } from 'next/server';
import { queryOne, query } from '@/lib/db';
import { User, Business } from '@/types/database';
import bcrypt from 'bcryptjs';
import { signAccessToken, signRefreshToken, setSessionCookies } from '@/lib/jwt';
import { checkRateLimit, getClientIp } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

// 5 login attempts per IP per 15 minutes
const LOGIN_LIMIT = 5;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;

export async function GET() {
  return NextResponse.json({ message: 'Login API endpoint is working' });
}

export async function POST(request: NextRequest) {
  try {
    const ip = getClientIp(request);
    const rl = checkRateLimit(`login:${ip}`, LOGIN_LIMIT, LOGIN_WINDOW_MS);
    if (!rl.allowed) {
      return NextResponse.json(
        { error: 'Too many login attempts. Please try again later.', retryAfterMs: rl.retryAfterMs },
        { status: 429 }
      );
    }

    const body = await request.json();
    const { phone, password } = body;

    if (!phone || !password) {
      return NextResponse.json(
        { error: 'Phone number and password are required' },
        { status: 400 }
      );
    }

    const normalizePhone = (phone: string): string[] => {
      let cleaned = phone.replace(/[^\d+]/g, '');
      const formats = [cleaned];
      
      if (cleaned.startsWith('+91')) {
        formats.push(cleaned.substring(3));
      } else if (cleaned.startsWith('91') && cleaned.length >= 12) {
        formats.push(cleaned.substring(2));
      } else if (cleaned.length === 10) {
        formats.push('+91' + cleaned);
        formats.push('91' + cleaned);
      }
      
      return [...new Set(formats)];
    };

    const phoneFormats = normalizePhone(phone);
    
    let user: User | null = null;
    for (const phoneFormat of phoneFormats) {
      user = await queryOne<User>(
        'SELECT * FROM users WHERE phone = $1',
        [phoneFormat]
      );
      if (user) break;
    }

    if (!user) {
      return NextResponse.json(
        { error: 'Invalid phone number or password' },
        { status: 401 }
      );
    }

    if (!user.password_hash) {
      return NextResponse.json(
        { error: 'Invalid password' },
        { status: 401 }
      );
    }
    
    // Only accept bcrypt-hashed passwords
    if (!user.password_hash.startsWith('$2a$') && !user.password_hash.startsWith('$2b$') && !user.password_hash.startsWith('$2y$')) {
      return NextResponse.json(
        { error: 'Password needs to be reset. Please contact your administrator.' },
        { status: 401 }
      );
    }

    const isValid = await bcrypt.compare(password, user.password_hash);
    if (!isValid) {
      return NextResponse.json(
        { error: 'Invalid password' },
        { status: 401 }
      );
    }

    const employee = await queryOne<{ access_type: 'full' | 'attendance_only' }>(
      `SELECT access_type FROM employees WHERE id = $1 AND is_active = true`,
      [user.id]
    );

    if (employee && employee.access_type === 'attendance_only') {
      return NextResponse.json(
        {
          error: 'This account is for attendance only. Please use the attendance login page.',
          code: 'ATTENDANCE_ONLY_ACCOUNT'
        },
        { status: 403 }
      );
    }

    const allowMultidevice = user.allow_multidevice_sync === true;

    let sessionVersion: number;
    if (!allowMultidevice) {
      const bumped = await queryOne<{ auth_session_version: string }>(
        `UPDATE users
         SET last_active_at = CURRENT_TIMESTAMP,
             auth_session_version = auth_session_version + 1
         WHERE id = $1
         RETURNING auth_session_version`,
        [user.id]
      );
      sessionVersion = Number(bumped?.auth_session_version ?? 1);
    } else {
      await query(
        'UPDATE users SET last_active_at = CURRENT_TIMESTAMP WHERE id = $1',
        [user.id]
      );
      const row = await queryOne<{ auth_session_version: string }>(
        'SELECT auth_session_version FROM users WHERE id = $1',
        [user.id]
      );
      sessionVersion = Number(row?.auth_session_version ?? 1);
    }

    const updatedUser = await queryOne<User>(
      'SELECT * FROM users WHERE id = $1',
      [user.id]
    );

    const { password_hash, ...safeUser } = updatedUser || user;

    const business = await queryOne<Business & { platform_suspended_at?: string | null }>(
      'SELECT * FROM businesses WHERE id = $1',
      [user.business_id]
    );

    if (business?.platform_suspended_at) {
      return NextResponse.json(
        {
          error: 'This account has been suspended. Please contact Khatario support.',
          code: 'BUSINESS_SUSPENDED',
        },
        { status: 403 },
      );
    }

    const tokenPayload = { userId: user.id, businessId: user.business_id, sessionVersion };
    const [accessToken, refreshToken] = await Promise.all([
      signAccessToken(tokenPayload),
      signRefreshToken(tokenPayload),
    ]);

    const response = NextResponse.json({
      success: true,
      user: safeUser,
      business: business || null,
      message: 'Login successful'
    });

    setSessionCookies(response, accessToken, refreshToken);

    return response;

  } catch (error: any) {
    console.error('Login error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
