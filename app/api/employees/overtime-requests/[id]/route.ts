import { NextRequest, NextResponse } from 'next/server';
import { getBusinessIdFromRequest, getUserIdFromRequest } from '@/lib/auth-helpers';
import { queryOne } from '@/lib/db';
import { authorize, AuthorizationError } from '@/lib/authorization';
import {
  decideOtRequestApproval,
} from '@/lib/hr/shift-overtime/ot-request-approval';
import { getOtPolicy } from '@/lib/hr/shift-overtime/ot-policy';
import { canApproveForEmployee } from '@/lib/hr/manager-scope';
import { getHrApprovalSettings } from '@/lib/hr/hr-approval-settings';
import { finalizeApprovedOtRequest } from '@/lib/hr/shift-overtime/ot-payroll';

export const dynamic = 'force-dynamic';

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    const requestId = params.id;
    const body = await request.json();
    const businessId = getBusinessIdFromRequest(request);
    const userId = body.updated_by_user_id ?? getUserIdFromRequest(request);

    if (!businessId || !userId) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    const { action, rejection_reason, hold_reason, comments } = body;
    if (!['approve', 'reject', 'cancel', 'hold'].includes(action)) {
      return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
    }

    const otRequest = await queryOne<{ status: string; employee_id: string }>(
      `SELECT status, employee_id FROM overtime_requests WHERE id = $1 AND business_id = $2`,
      [requestId, businessId],
    );
    if (!otRequest) {
      return NextResponse.json({ error: 'Overtime request not found' }, { status: 404 });
    }

    if (action === 'cancel') {
      if (userId !== otRequest.employee_id) {
        await authorize(userId, 'leave_requests', 'update', { businessId });
      }
      if (otRequest.status !== 'pending') {
        return NextResponse.json({ error: 'Only pending requests can be cancelled' }, { status: 400 });
      }
      await queryOne(
        `UPDATE overtime_requests SET status = 'cancelled', updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
        [requestId],
      );
      return NextResponse.json({ ok: true });
    }

    const policy = await getOtPolicy(businessId);
    const hasChain = (policy?.approval_chain.length ?? 0) > 0;

    if (hasChain) {
      const chainAction =
        action === 'approve' ? 'approve' : action === 'reject' ? 'reject' : 'hold';
      const result = await decideOtRequestApproval({
        overtimeRequestId: requestId,
        businessId,
        actorUserId: userId,
        action: chainAction,
        hold_reason,
        comments: rejection_reason ?? comments,
      });
      if (!result.ok) {
        return NextResponse.json({ error: result.message }, { status: 400 });
      }
      return NextResponse.json({ ok: true, status: result.request_status });
    }

    const settings = await getHrApprovalSettings(businessId);
    const allowed = await canApproveForEmployee(
      userId,
      businessId,
      otRequest.employee_id,
      'leave',
      settings,
    );
    if (!allowed && action !== 'reject') {
      try {
        await authorize(userId, 'leave_requests', 'update', { businessId });
      } catch (error) {
        if (error instanceof AuthorizationError) return error.toNextResponse();
        throw error;
      }
    }

    if (action === 'approve') {
      await queryOne(
        `UPDATE overtime_requests SET status = 'approved', approved_by = $2, approved_at = CURRENT_TIMESTAMP WHERE id = $1`,
        [requestId, userId],
      );
      await finalizeApprovedOtRequest(requestId, businessId);
    } else if (action === 'reject') {
      await queryOne(
        `UPDATE overtime_requests SET status = 'rejected', rejection_reason = $2, rejected_at = CURRENT_TIMESTAMP WHERE id = $1`,
        [requestId, rejection_reason ?? null],
      );
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof AuthorizationError) return error.toNextResponse();
    const message = error instanceof Error ? error.message : 'Action failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
