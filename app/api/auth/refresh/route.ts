import { NextRequest, NextResponse } from 'next/server';
import {
  verifyToken,
  signAccessToken,
  signRefreshToken,
  setSessionCookies,
  REFRESH_COOKIE,
  clearSessionCookie,
} from '@/lib/jwt';
import { queryOne } from '@/lib/db';

function sessionRevokedResponse(): NextResponse {
  const res = NextResponse.json(
    { error: 'Session revoked or expired', code: 'SESSION_REVOKED' },
    { status: 401 }
  );
  clearSessionCookie(res);
  return res;
}

export async function POST(request: NextRequest) {
  const refreshToken = request.cookies.get(REFRESH_COOKIE)?.value;
  if (!refreshToken) {
    return NextResponse.json({ error: 'No refresh token' }, { status: 401 });
  }

  const payload = await verifyToken(refreshToken);
  if (!payload || payload.type !== 'refresh') {
    return sessionRevokedResponse();
  }

  if (typeof payload.sv !== 'number') {
    return sessionRevokedResponse();
  }

  const row = await queryOne<{ auth_session_version: string }>(
    `SELECT auth_session_version::text AS auth_session_version
     FROM users WHERE id = $1 AND is_active = true`,
    [payload.userId]
  );

  if (!row) {
    return sessionRevokedResponse();
  }

  const dbSv = Number(row.auth_session_version);
  if (payload.sv !== dbSv) {
    return sessionRevokedResponse();
  }

  const tokenPayload = {
    userId: payload.userId,
    businessId: payload.businessId,
    sessionVersion: dbSv,
  };
  const [newAccess, newRefresh] = await Promise.all([
    signAccessToken(tokenPayload),
    signRefreshToken(tokenPayload),
  ]);

  const response = NextResponse.json({ success: true });
  setSessionCookies(response, newAccess, newRefresh);
  return response;
}
