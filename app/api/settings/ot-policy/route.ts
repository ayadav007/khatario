import { NextRequest, NextResponse } from 'next/server';
import { getBusinessIdFromRequest, getUserIdFromRequest } from '@/lib/auth-helpers';
import { authorize, AuthorizationError } from '@/lib/authorization';
import { getOtPolicyBundle, saveOtPolicy } from '@/lib/hr/shift-overtime/ot-policy';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const businessId = getBusinessIdFromRequest(request);
    const userId = getUserIdFromRequest(request);
    if (!businessId || !userId) return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    await authorize(userId, 'settings', 'read', { businessId });
    return NextResponse.json(await getOtPolicyBundle(businessId));
  } catch (error) {
    if (error instanceof AuthorizationError) return error.toNextResponse();
    return NextResponse.json({ error: 'Failed to load OT policy' }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const businessId = getBusinessIdFromRequest(request);
    const userId = getUserIdFromRequest(request);
    if (!businessId || !userId) return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    await authorize(userId, 'settings', 'update', { businessId });
    const body = await request.json();
    const saved = await saveOtPolicy(businessId, body);
    return NextResponse.json(saved);
  } catch (error) {
    if (error instanceof AuthorizationError) return error.toNextResponse();
    return NextResponse.json({ error: 'Failed to save OT policy' }, { status: 400 });
  }
}
