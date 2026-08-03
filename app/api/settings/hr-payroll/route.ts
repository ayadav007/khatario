import { NextRequest, NextResponse } from 'next/server';
import { getBusinessIdFromRequest, getUserIdFromRequest } from '@/lib/auth-helpers';
import { authorize, AuthorizationError } from '@/lib/authorization';
import {
  getHrPayrollSettings,
  updateHrPayrollSettings,
  type HrPayrollSettings,
} from '@/lib/hr/hr-payroll-settings';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const businessId = getBusinessIdFromRequest(request);
    const userId = getUserIdFromRequest(request);
    if (!businessId || !userId) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    await authorize(userId, 'settings', 'read', { businessId });
    const settings = await getHrPayrollSettings(businessId);
    return NextResponse.json({ settings });
  } catch (error) {
    if (error instanceof AuthorizationError) return error.toNextResponse();
    console.error('[settings/hr-payroll GET]', error);
    return NextResponse.json({ error: 'Failed to load payroll settings' }, { status: 500 });
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
    const patch: Partial<HrPayrollSettings> = {};
    const keys: (keyof HrPayrollSettings)[] = [
      'monthly_pay_day',
      'pf_enabled',
      'pf_establishment_id',
      'pf_employee_rate',
      'pf_employer_rate',
      'pf_wage_ceiling',
      'esi_enabled',
      'esi_code',
      'esi_employee_rate',
      'esi_employer_rate',
      'esi_wage_ceiling',
      'pt_enabled',
      'pt_state',
      'pt_registration_no',
    ];
    for (const key of keys) {
      if (Object.prototype.hasOwnProperty.call(body, key)) {
        (patch as Record<string, unknown>)[key] = body[key];
      }
    }

    const settings = await updateHrPayrollSettings(businessId, patch);
    return NextResponse.json({ settings });
  } catch (error) {
    if (error instanceof AuthorizationError) return error.toNextResponse();
    console.error('[settings/hr-payroll PATCH]', error);
    return NextResponse.json({ error: 'Failed to save payroll settings' }, { status: 500 });
  }
}
