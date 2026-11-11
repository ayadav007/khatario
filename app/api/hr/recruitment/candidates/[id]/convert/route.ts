import { NextRequest, NextResponse } from 'next/server';
import { getUserIdFromRequest, getBusinessIdFromRequest } from '@/lib/auth-helpers';
import { authorize, AuthorizationError } from '@/lib/authorization';
import { queryOne } from '@/lib/db';
import { convertCandidateToEmployee } from '@/lib/hr/recruitment/convert-candidate';

export const dynamic = 'force-dynamic';

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    const businessId = getBusinessIdFromRequest(request);
    const userId = getUserIdFromRequest(request);
    if (!businessId || !userId) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }
    await authorize(userId, 'recruitment', 'update', { businessId, resourceId: params.id });
    await authorize(userId, 'employees', 'create', { businessId });

    const body = await request.json();
    if (!body?.physical_documents_verified) {
      return NextResponse.json(
        { error: 'Confirm physical document verification before converting' },
        { status: 400 },
      );
    }

    const reportingManagerId = body?.reporting_manager_id ? String(body.reporting_manager_id) : null;
    if (reportingManagerId) {
      const manager = await queryOne(
        `SELECT id FROM employees WHERE id = $1 AND business_id = $2`,
        [reportingManagerId, businessId],
      );
      if (!manager) {
        return NextResponse.json({ error: 'Reporting manager not found' }, { status: 404 });
      }
    }

    const result = await convertCandidateToEmployee({
      businessId,
      candidateId: params.id,
      actorUserId: userId,
      physicalDocumentsVerified: true,
      reportingManagerId,
      employeeCode: body?.employee_code || null,
    });

    return NextResponse.json({
      ok: true,
      employee_id: result.employee_id,
      salary_structure_id: result.salary_structure_id,
    });
  } catch (error) {
    if (error instanceof AuthorizationError) return error.toNextResponse();
    const message = error instanceof Error ? error.message : 'Conversion failed';
    console.error('[recruitment/convert POST]', error);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
