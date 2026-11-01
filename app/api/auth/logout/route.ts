import { NextRequest, NextResponse } from 'next/server';
import { clearSessionCookie, getSessionFromRequest } from '@/lib/jwt';
import { query } from '@/lib/db';

export const dynamic = 'force-dynamic';

/**
 * Clears the cookies and revokes the session server-side: bumping auth_session_version makes
 * every token issued before now (access and refresh, on any device) fail the version check.
 */
export async function POST(request: NextRequest) {
  const session = await getSessionFromRequest(request);
  if (session?.userId && typeof session.sv === 'number') {
    try {
      await query(
        `UPDATE users SET auth_session_version = COALESCE(auth_session_version, 1) + 1
          WHERE id = $1 AND COALESCE(auth_session_version, 1) = $2`,
        [session.userId, session.sv]
      );
    } catch (error) {
      console.error('[auth/logout] session revoke failed', error);
    }
  }
  const response = NextResponse.json({ success: true, message: 'Logged out' });
  clearSessionCookie(response);
  return response;
}
