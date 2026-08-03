import { NextRequest, NextResponse } from 'next/server';
import { getBusinessIdFromRequest, getUserIdFromRequest } from '@/lib/auth-helpers';
import { authorize, AuthorizationError } from '@/lib/authorization';
import { getExitDetail, updateExitTask, updateFnf } from '@/lib/hr/exit-process';
import { decideExitApproval } from '@/lib/hr/exit-approval';

export const dynamic = 'force-dynamic';

export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    const businessId = getBusinessIdFromRequest(_request);
    const userId = getUserIdFromRequest(_request);
    if (!businessId || !userId) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }
    await authorize(userId, 'employees', 'read', { businessId });

    const detail = await getExitDetail(businessId, params.id);
    if (!detail) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const { checkUserPermissionWithAliases } = await import('@/lib/permissions');
    const isHr = await checkUserPermissionWithAliases(userId, 'employees', 'update');
    const activeStep = detail.approvals.find((a) => ['awaiting', 'on_hold'].includes(a.status));
    const canAct =
      !!activeStep &&
      (activeStep.role_type === 'hr'
        ? isHr
        : activeStep.approver_user_id === userId);

    return NextResponse.json({
      ...detail,
      permissions: {
        can_hr_reject: isHr && ['pending_approval', 'approval_on_hold'].includes(String(detail.exit.status)),
        can_act_on_step: canAct,
      },
    });
  } catch (error) {
    if (error instanceof AuthorizationError) return error.toNextResponse();
    return NextResponse.json({ error: 'Failed to load exit' }, { status: 500 });
  }
}

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

    const body = await request.json();

    if (['approve', 'hold', 'reject', 'grant_exception'].includes(body.action)) {
      const result = await decideExitApproval({
        exitId: params.id,
        businessId,
        actorUserId: userId,
        action: body.action,
        hold_reason: body.hold_reason ? String(body.hold_reason) : undefined,
        comments: body.comments ? String(body.comments) : undefined,
      });
      if (!result.ok) {
        return NextResponse.json({ error: result.message }, { status: 400 });
      }
      return NextResponse.json({ ok: true, exit_status: result.exit_status });
    }

    await authorize(userId, 'employees', 'update', { businessId });

    if (body.action === 'update_task') {
      await updateExitTask(params.id, String(body.task_id), {
        status: body.status ? String(body.status) : undefined,
        notes: body.notes != null ? String(body.notes) : undefined,
      });
      return NextResponse.json({ ok: true });
    }

    if (body.action === 'update_fnf') {
      await updateFnf(params.id, businessId, {
        fnf_status: body.fnf_status ? String(body.fnf_status) : undefined,
        fnf_amount_due: body.fnf_amount_due != null ? Number(body.fnf_amount_due) : undefined,
        fnf_amount_recovery:
          body.fnf_amount_recovery != null ? Number(body.fnf_amount_recovery) : undefined,
        fnf_settled: body.fnf_settled === true,
      });
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  } catch (error) {
    if (error instanceof AuthorizationError) return error.toNextResponse();
    const message = error instanceof Error ? error.message : 'Failed to update exit';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
