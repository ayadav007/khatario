import { NextResponse } from 'next/server';
import { clearPlatformSessionCookie } from '@/lib/platform-jwt';

export const dynamic = 'force-dynamic';

/**
 * POST /api/admin/auth/logout — clear platform admin httpOnly session.
 */
export async function POST() {
  const res = NextResponse.json({ success: true });
  clearPlatformSessionCookie(res);
  return res;
}
