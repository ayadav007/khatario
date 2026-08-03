import { NextRequest, NextResponse } from 'next/server';
import { getEmployeePortalSessionFromRequest } from '@/lib/employee-portal/session';
import { assertEmployeePortalFeature } from '@/lib/employee-portal/feature-gates';
import { FeatureAccessDeniedError } from '@/lib/subscription/feature-access';
import type { EssModule } from '@/lib/employee-portal/feature-gates';

export type PortalSessionContext = {
  businessId: string;
  employeeId: string;
  employeeName: string;
  employeeCode: string;
};

export async function requirePortalSession(
  request: NextRequest,
): Promise<{ session: PortalSessionContext } | { error: NextResponse }> {
  const session = await getEmployeePortalSessionFromRequest(request);
  if (!session) {
    return { error: NextResponse.json({ error: 'Not authenticated' }, { status: 401 }) };
  }
  return {
    session: {
      businessId: session.business_id,
      employeeId: session.employee_id,
      employeeName: session.employee_name,
      employeeCode: session.employee_code,
    },
  };
}

export async function requirePortalFeature(
  businessId: string,
  module: EssModule,
): Promise<NextResponse | null> {
  try {
    await assertEmployeePortalFeature(businessId, module);
    return null;
  } catch (error) {
    if (error instanceof FeatureAccessDeniedError) return error.toNextResponse();
    throw error;
  }
}
