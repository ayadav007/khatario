import { NextRequest, NextResponse } from 'next/server';
import {
  clearPartnerSessionCookie,
  destroyPartnerSession,
  getPartnerTokenFromRequest,
} from '@/lib/partners/session';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  await destroyPartnerSession(getPartnerTokenFromRequest(request));
  const response = NextResponse.json({ success: true });
  clearPartnerSessionCookie(response);
  return response;
}
