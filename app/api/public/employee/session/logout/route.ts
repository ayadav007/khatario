import { NextRequest, NextResponse } from 'next/server';
import {
  destroyEmployeePortalSession,
  clearEmployeePortalCookie,
  getEmployeePortalTokenFromRequest,
} from '@/lib/employee-portal/session';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const token = getEmployeePortalTokenFromRequest(request);
  await destroyEmployeePortalSession(token);
  const response = NextResponse.json({ success: true });
  clearEmployeePortalCookie(response);
  return response;
}
