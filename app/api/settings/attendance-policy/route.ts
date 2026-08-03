import { NextRequest, NextResponse } from 'next/server';
import { getBusinessIdFromRequest, getUserIdFromRequest } from '@/lib/auth-helpers';
import { authorize, AuthorizationError } from '@/lib/authorization';
import {
  getAttendancePolicy,
  updateAttendancePolicy,
  type AttendancePolicy,
  DEFAULT_ATTENDANCE_POLICY,
} from '@/lib/hr/attendance-policy';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const businessId = getBusinessIdFromRequest(request);
    const userId = getUserIdFromRequest(request);
    if (!businessId || !userId) {
      return NextResponse.json({ error: 'business_id and user_id are required' }, { status: 400 });
    }

    await authorize(userId, 'settings', 'read', { businessId });

    const policy = await getAttendancePolicy(businessId);
    return NextResponse.json({ policy });
  } catch (error) {
    if (error instanceof AuthorizationError) return error.toNextResponse();
    console.error('[settings/attendance-policy GET]', error);
    return NextResponse.json({ error: 'Failed to load attendance policy' }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const businessId = getBusinessIdFromRequest(request);
    const userId = getUserIdFromRequest(request);
    if (!businessId || !userId) {
      return NextResponse.json({ error: 'business_id and user_id are required' }, { status: 400 });
    }

    await authorize(userId, 'settings', 'update', { businessId });

    const body = await request.json();
    const partial: Partial<AttendancePolicy> = {};
    if (body && typeof body === 'object') {
      for (const key of Object.keys(DEFAULT_ATTENDANCE_POLICY) as (keyof AttendancePolicy)[]) {
        if (body[key] !== undefined) {
          (partial as Record<string, unknown>)[key] = body[key];
        }
      }
    }
    const policy = await updateAttendancePolicy(businessId, partial);
    return NextResponse.json({ policy });
  } catch (error) {
    if (error instanceof AuthorizationError) return error.toNextResponse();
    console.error('[settings/attendance-policy PATCH]', error);
    return NextResponse.json({ error: 'Failed to save attendance policy' }, { status: 500 });
  }
}
