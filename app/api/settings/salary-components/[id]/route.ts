import { NextRequest, NextResponse } from 'next/server';
import { getBusinessIdFromRequest, getUserIdFromRequest } from '@/lib/auth-helpers';
import { authorize, AuthorizationError } from '@/lib/authorization';
import {
  updateSalaryComponent,
  type SalaryCalcType,
} from '@/lib/hr/salary-components';

export const dynamic = 'force-dynamic';

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    const businessId = getBusinessIdFromRequest(request);
    const userId = getUserIdFromRequest(request);
    if (!businessId || !userId) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    await authorize(userId, 'settings', 'update', { businessId });

    const body = await request.json();
    const patch: Parameters<typeof updateSalaryComponent>[2] = {};
    if (body.name !== undefined) patch.name = String(body.name);
    if (body.calculation_type !== undefined) {
      patch.calculation_type = body.calculation_type as SalaryCalcType;
    }
    if (body.is_active !== undefined) patch.is_active = !!body.is_active;
    if (body.sort_order !== undefined) patch.sort_order = Number(body.sort_order);

    const component = await updateSalaryComponent(businessId, params.id, patch);
    return NextResponse.json({ component });
  } catch (error) {
    if (error instanceof AuthorizationError) return error.toNextResponse();
    const message = error instanceof Error ? error.message : 'Failed to update component';
    console.error('[settings/salary-components PATCH]', error);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
