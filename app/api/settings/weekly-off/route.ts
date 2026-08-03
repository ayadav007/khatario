import { NextRequest, NextResponse } from 'next/server';
import { getBusinessIdFromRequest, getUserIdFromRequest } from '@/lib/auth-helpers';
import { authorize, AuthorizationError } from '@/lib/authorization';
import {
  getBusinessWeeklyOffPolicy,
  saveBusinessWeeklyOffPolicy,
} from '@/lib/hr/shift-overtime/weekly-off';
import type { WeeklyOffPolicy } from '@/lib/hr/shift-overtime/types';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const businessId = getBusinessIdFromRequest(request);
    const userId = getUserIdFromRequest(request);
    if (!businessId || !userId) return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    await authorize(userId, 'settings', 'read', { businessId });
    return NextResponse.json({ policy: await getBusinessWeeklyOffPolicy(businessId) });
  } catch (error) {
    if (error instanceof AuthorizationError) return error.toNextResponse();
    return NextResponse.json({ error: 'Failed to load weekly off policy' }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const businessId = getBusinessIdFromRequest(request);
    const userId = getUserIdFromRequest(request);
    if (!businessId || !userId) return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    await authorize(userId, 'settings', 'update', { businessId });
    const body = await request.json();
    const policy = await saveBusinessWeeklyOffPolicy(businessId, body.policy as WeeklyOffPolicy);
    return NextResponse.json({ policy });
  } catch (error) {
    if (error instanceof AuthorizationError) return error.toNextResponse();
    return NextResponse.json({ error: 'Failed to save weekly off policy' }, { status: 400 });
  }
}
