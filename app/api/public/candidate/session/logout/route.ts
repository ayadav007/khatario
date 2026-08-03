import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import {
  clearCandidatePortalCookie,
  getCandidatePortalSessionFromRequest,
} from '@/lib/hr/recruitment/candidate-portal-session';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const session = await getCandidatePortalSessionFromRequest(request);
  const res = NextResponse.json({ ok: true });
  if (session) {
    await query(`DELETE FROM candidate_portal_sessions WHERE session_token = $1`, [session.session_token]);
  }
  clearCandidatePortalCookie(res);
  return res;
}
