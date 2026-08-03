import { NextRequest, NextResponse } from 'next/server';
import { getBusinessIdFromRequest, getUserIdFromRequest } from '@/lib/auth-helpers';
import { authorize, AuthorizationError } from '@/lib/authorization';
import { getHrPortalSettings, updateHrPortalSettings } from '@/lib/hr/hr-portal-settings';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const businessId = getBusinessIdFromRequest(request);
    const userId = getUserIdFromRequest(request);
    if (!businessId || !userId) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    await authorize(userId, 'settings', 'read', { businessId });
    const settings = await getHrPortalSettings(businessId);
    return NextResponse.json({ settings });
  } catch (error) {
    if (error instanceof AuthorizationError) return error.toNextResponse();
    console.error('[settings/hr-portal GET]', error);
    return NextResponse.json({ error: 'Failed to load portal settings' }, { status: 500 });
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
    const settings = await updateHrPortalSettings(businessId, {
      kiosk_enabled: body.kiosk_enabled,
    });
    return NextResponse.json({ settings });
  } catch (error) {
    if (error instanceof AuthorizationError) return error.toNextResponse();
    console.error('[settings/hr-portal PATCH]', error);
    return NextResponse.json({ error: 'Failed to save portal settings' }, { status: 500 });
  }
}
