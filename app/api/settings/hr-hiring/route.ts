import { NextRequest, NextResponse } from 'next/server';
import { getBusinessIdFromRequest, getUserIdFromRequest } from '@/lib/auth-helpers';
import { authorize, AuthorizationError } from '@/lib/authorization';
import { getHrHiringSettings, updateHrHiringSettings } from '@/lib/hr/hr-hiring-settings';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const businessId = getBusinessIdFromRequest(request);
    const userId = getUserIdFromRequest(request);
    if (!businessId || !userId) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    await authorize(userId, 'settings', 'read', { businessId });
    const settings = await getHrHiringSettings(businessId);
    return NextResponse.json({ settings });
  } catch (error) {
    if (error instanceof AuthorizationError) return error.toNextResponse();
    console.error('[settings/hr-hiring GET]', error);
    return NextResponse.json({ error: 'Failed to load hiring settings' }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const businessId = getBusinessIdFromRequest(request);
    const userId = getUserIdFromRequest(request);
    if (!businessId || !userId) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    await authorize(userId, 'settings', 'update', { businessId });

    const body = await request.json();
    const settings = await updateHrHiringSettings(businessId, {
      auto_send_onboarding_invite: body.auto_send_onboarding_invite,
    });
    return NextResponse.json({ settings });
  } catch (error) {
    if (error instanceof AuthorizationError) return error.toNextResponse();
    console.error('[settings/hr-hiring PATCH]', error);
    return NextResponse.json({ error: 'Failed to save hiring settings' }, { status: 500 });
  }
}
