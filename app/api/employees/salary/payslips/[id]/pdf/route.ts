import { NextRequest, NextResponse } from 'next/server';
import { queryOne } from '@/lib/db';
import { generatePayslipPdf } from '@/lib/payslip-generator';
import { getUserIdFromRequest, getBusinessIdFromRequest } from '@/lib/auth-helpers';
import { authorize, AuthorizationError } from '@/lib/authorization';
import {
  resolveActorContext,
  assertPortalFeatureForRequest,
  assertPortalOwnResource,
} from '@/lib/employee-portal/portal-api-guard';
import { FeatureAccessDeniedError } from '@/lib/subscription/feature-access';

export const dynamic = 'force-dynamic';

/**
 * GET /api/employees/salary/payslips/[id]/pdf
 * Generate and download payslip PDF
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const salaryPaymentId = params.id;
    const actor = await resolveActorContext(request);
    let businessId = getBusinessIdFromRequest(request);
    let userId = getUserIdFromRequest(request);
    if (actor) {
      businessId = actor.businessId;
      userId = actor.userId;
    }

    if (!businessId) {
      return NextResponse.json({ error: 'business_id is required' }, { status: 400 });
    }

    if (!userId) {
      return NextResponse.json(
        { error: 'user_id is required for authorization' },
        { status: 400 }
      );
    }

    if (actor?.isPortal) {
      try {
        await assertPortalFeatureForRequest(request, actor.businessId, 'payslips');
      } catch (error) {
        if (error instanceof FeatureAccessDeniedError) return error.toNextResponse();
        throw error;
      }
    }

    const salaryPayment = await queryOne<{
      id: string;
      employee_id: string;
    }>(
      'SELECT id, employee_id FROM salary_payments WHERE id = $1 AND business_id = $2',
      [salaryPaymentId, businessId]
    );

    if (!salaryPayment) {
      return NextResponse.json({ error: 'Salary payment not found' }, { status: 404 });
    }

    if (actor?.isPortal) {
      const forbidden = assertPortalOwnResource(actor, salaryPayment.employee_id);
      if (forbidden) return forbidden;
    }

    let allowed = actor?.isPortal && salaryPayment.employee_id === userId;
    try {
      await authorize(userId, 'payroll', 'read', { businessId });
      allowed = true;
    } catch (error) {
      if (!(error instanceof AuthorizationError)) throw error;
    }

    if (!allowed && salaryPayment.employee_id === userId) {
      allowed = true;
    }

    if (!allowed) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const pdfBuffer = await generatePayslipPdf(salaryPaymentId);

    return new NextResponse(pdfBuffer as any, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="payslip-${salaryPaymentId}.pdf"`,
      },
    });
  } catch (error: any) {
    console.error('Error generating payslip PDF:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}
