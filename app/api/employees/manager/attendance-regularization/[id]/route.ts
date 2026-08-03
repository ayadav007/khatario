import { NextRequest, NextResponse } from 'next/server';
import { resolveActorContext } from '@/lib/employee-portal/portal-api-guard';
import { decideRegularizationRequest } from '@/lib/hr/attendance-regularization';

export const dynamic = 'force-dynamic';

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    const actor = await resolveActorContext(request);
    if (!actor) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    const body = await request.json();
    const action = body?.action;
    if (action !== 'approve' && action !== 'reject') {
      return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
    }

    const result = await decideRegularizationRequest({
      requestId: params.id,
      businessId: actor.businessId,
      managerEmployeeId: actor.userId,
      action,
      rejection_reason: body.rejection_reason ? String(body.rejection_reason) : undefined,
    });

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }

    return NextResponse.json({ ok: true, status: result.status });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Action failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
