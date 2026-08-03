import { NextRequest, NextResponse } from 'next/server';
import { resolveActorContext } from '@/lib/employee-portal/portal-api-guard';
import { decideOtRequestApproval } from '@/lib/hr/shift-overtime/ot-request-approval';

export const dynamic = 'force-dynamic';

export async function PATCH(
  request: NextRequest,
  { params }: { params: { overtimeRequestId: string } },
) {
  try {
    const actor = await resolveActorContext(request);
    if (!actor) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    const body = await request.json();
    const action = body?.action;
    if (!['approve', 'hold', 'reject'].includes(action)) {
      return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
    }

    const result = await decideOtRequestApproval({
      overtimeRequestId: params.overtimeRequestId,
      businessId: actor.businessId,
      actorUserId: actor.userId,
      action,
      hold_reason: body.hold_reason ? String(body.hold_reason) : undefined,
      comments: body.comments ? String(body.comments) : undefined,
    });

    if (!result.ok) {
      return NextResponse.json({ error: result.message }, { status: 400 });
    }

    return NextResponse.json({ ok: true, request_status: result.request_status });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Action failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
