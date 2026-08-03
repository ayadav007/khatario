import { NextRequest, NextResponse } from 'next/server';
import { queryRows } from '@/lib/db';
import {
  resolveActorContext,
  assertPortalFeatureForRequest,
  enforcePortalSelfScope,
} from '@/lib/employee-portal/portal-api-guard';
import { FeatureAccessDeniedError } from '@/lib/subscription/feature-access';
import { authorize, AuthorizationError } from '@/lib/authorization';

export const dynamic = 'force-dynamic';

/**
 * GET /api/employees/salary/payslips
 * List payslips for the authenticated employee (portal self-service or admin).
 */
export async function GET(request: NextRequest) {
  try {
    const actor = await resolveActorContext(request);
    if (!actor) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    try {
      await assertPortalFeatureForRequest(request, actor.businessId, 'payslips');
    } catch (error) {
      if (error instanceof FeatureAccessDeniedError) return error.toNextResponse();
      throw error;
    }

    const { searchParams } = new URL(request.url);
    const requestedEmployee = searchParams.get('employee_id');
    const employeeId = enforcePortalSelfScope(actor, requestedEmployee);

    if (!actor.isPortal) {
      if (requestedEmployee && requestedEmployee !== actor.userId) {
        try {
          await authorize(actor.userId, 'payroll', 'read', { businessId: actor.businessId });
        } catch (error) {
          if (error instanceof AuthorizationError) return error.toNextResponse();
          throw error;
        }
      } else if (requestedEmployee !== actor.userId) {
        try {
          await authorize(actor.userId, 'payroll', 'read', { businessId: actor.businessId });
        } catch (error) {
          if (!(error instanceof AuthorizationError)) throw error;
        }
      }
    }

    const targetEmployeeId = requestedEmployee && !actor.isPortal ? requestedEmployee : employeeId;

    const payslips = await queryRows<{
      id: string;
      salary_month: string;
      net_salary: number;
      status: string;
      employee_id: string;
    }>(
      `SELECT sp.id, sp.salary_month, sp.net_salary, sp.status, sp.employee_id
       FROM salary_payments sp
       WHERE sp.business_id = $1 AND sp.employee_id = $2
       ORDER BY sp.salary_month DESC
       LIMIT 24`,
      [actor.businessId, targetEmployeeId]
    );

    return NextResponse.json({ payslips });
  } catch (error: unknown) {
    console.error('Error listing payslips:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}
