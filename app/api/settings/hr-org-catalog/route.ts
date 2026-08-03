import { NextRequest, NextResponse } from 'next/server';
import { getBusinessIdFromRequest, getUserIdFromRequest } from '@/lib/auth-helpers';
import { authorize, AuthorizationError } from '@/lib/authorization';
import { getHrOrgCatalog, updateHrOrgCatalog } from '@/lib/hr/hr-org-catalog';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const businessId = getBusinessIdFromRequest(request);
    const userId = getUserIdFromRequest(request);
    if (!businessId || !userId) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    await authorize(userId, 'settings', 'read', { businessId });
    const catalog = await getHrOrgCatalog(businessId);
    return NextResponse.json({ catalog });
  } catch (error) {
    if (error instanceof AuthorizationError) return error.toNextResponse();
    console.error('[settings/hr-org-catalog GET]', error);
    return NextResponse.json({ error: 'Failed to load departments' }, { status: 500 });
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
    const catalog = await updateHrOrgCatalog(businessId, {
      departments: body.departments,
      designations: body.designations,
    });
    return NextResponse.json({ catalog });
  } catch (error) {
    if (error instanceof AuthorizationError) return error.toNextResponse();
    console.error('[settings/hr-org-catalog PATCH]', error);
    return NextResponse.json({ error: 'Failed to save departments' }, { status: 500 });
  }
}
