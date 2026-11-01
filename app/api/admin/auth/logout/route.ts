import { NextRequest, NextResponse } from 'next/server';
import { clearPlatformSessionCookie, getPlatformSessionFromRequest } from '@/lib/platform-jwt';
import { query } from '@/lib/db';

export const dynamic = 'force-dynamic';

/**
 * POST /api/admin/auth/logout — clear the platform admin cookie and revoke the session.
 */
export async function POST(request: NextRequest) {
  const session = await getPlatformSessionFromRequest(request);
  if (session?.adminId && typeof session.sv === 'number') {
    try {
      await query(
        `UPDATE platform_admins SET auth_session_version = COALESCE(auth_session_version, 1) + 1
          WHERE id = $1 AND COALESCE(auth_session_version, 1) = $2`,
        [session.adminId, session.sv]
      );
    } catch (error) {
      console.error('[admin/auth/logout] session revoke failed', error);
    }
  }
  const res = NextResponse.json({ success: true });
  clearPlatformSessionCookie(res);
  return res;
}
