export const dynamic = 'force-dynamic';

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
import { hasWhatsAppBotAddon } from '@/lib/subscription';
import { CONNECT_SEAT_PAUSED_MESSAGE } from '@/lib/users/connect-seats';

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

  const row = await queryOne<{
    auth_session_version: string;
    seat_type: string | null;
    business_id: string | null;
  }>(
    `SELECT u.auth_session_version::text AS auth_session_version,
            to_jsonb(u)->>'seat_type' AS seat_type,
            u.business_id
     FROM users u WHERE u.id = $1 AND u.is_active = true`,
    [payload.userId]
  );

  if (!row) {
    return sessionRevokedResponse();
  }

  const dbSv = Number(row.auth_session_version);
  if (payload.sv !== dbSv) {
    return sessionRevokedResponse();
  }

  if (row.seat_type === 'connect' && row.business_id && !(await hasWhatsAppBotAddon(row.business_id))) {
    const res = NextResponse.json(
      { error: CONNECT_SEAT_PAUSED_MESSAGE, code: 'CONNECT_SEAT_INACTIVE' },
      { status: 403 }
    );
    clearSessionCookie(res);
    return res;
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
