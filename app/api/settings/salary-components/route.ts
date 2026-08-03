import { NextRequest, NextResponse } from 'next/server';
import { getBusinessIdFromRequest, getUserIdFromRequest } from '@/lib/auth-helpers';
import { authorize, AuthorizationError } from '@/lib/authorization';
import {
  createSalaryComponent,
  listSalaryComponents,
  type SalaryCalcType,
  type SalaryComponentType,
} from '@/lib/hr/salary-components';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const businessId = getBusinessIdFromRequest(request);
    const userId = getUserIdFromRequest(request);
    if (!businessId || !userId) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    await authorize(userId, 'settings', 'read', { businessId });

    const activeOnly = new URL(request.url).searchParams.get('active_only') !== 'false';
    const components = await listSalaryComponents(businessId, { activeOnly });
    return NextResponse.json({ components });
  } catch (error) {
    if (error instanceof AuthorizationError) return error.toNextResponse();
    console.error('[settings/salary-components GET]', error);
    return NextResponse.json({ error: 'Failed to load salary components' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const businessId = getBusinessIdFromRequest(request);
    const userId = getUserIdFromRequest(request);
    if (!businessId || !userId) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    await authorize(userId, 'settings', 'update', { businessId });

    const body = await request.json();
    const component = await createSalaryComponent(businessId, {
      code: String(body.code ?? ''),
      name: String(body.name ?? ''),
      component_type: body.component_type as SalaryComponentType,
      calculation_type: (body.calculation_type as SalaryCalcType) || 'fixed',
      sort_order: body.sort_order != null ? Number(body.sort_order) : undefined,
    });
    return NextResponse.json({ component }, { status: 201 });
  } catch (error) {
    if (error instanceof AuthorizationError) return error.toNextResponse();
    const message = error instanceof Error ? error.message : 'Failed to create component';
    console.error('[settings/salary-components POST]', error);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
