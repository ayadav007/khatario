import { withLimitedCreate, type LimitSpec } from '@/lib/subscription/limit-lock';
import { limitRefusedResponse } from '@/lib/subscription/limit-response';
import { countNewOrgNames } from '@/lib/hr/org-limits';
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
    // A NEW department or designation name takes one of the plan's `max_departments` / `max_designations`
    // slots. Counted and saved under the limit lock; removing names or re-saving existing ones never does.
    const specs: LimitSpec[] = [];
    if (Array.isArray(body.departments)) {
      specs.push({ limitType: 'departments', adding: (c) => countNewOrgNames(c, businessId, 'departments', body.departments) });
    }
    if (Array.isArray(body.designations)) {
      specs.push({ limitType: 'designations', adding: (c) => countNewOrgNames(c, businessId, 'designations', body.designations) });
    }
    const catalog = await withLimitedCreate(businessId, specs, (client) =>
      updateHrOrgCatalog(
        businessId,
        { departments: body.departments, designations: body.designations },
        client,
      ),
    );
    return NextResponse.json({ catalog });
  } catch (error) {
    if (error instanceof AuthorizationError) return error.toNextResponse();
    const limitRefused = limitRefusedResponse(error);
    if (limitRefused) return limitRefused;
    console.error('[settings/hr-org-catalog PATCH]', error);
    return NextResponse.json({ error: 'Failed to save departments' }, { status: 500 });
  }
}
