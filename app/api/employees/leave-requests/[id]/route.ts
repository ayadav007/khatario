import { NextRequest, NextResponse } from 'next/server';
import { getBusinessIdFromRequest, getSessionScopedBusinessId, getUserIdFromRequest } from '@/lib/auth-helpers';
import { queryOne, query } from '@/lib/db';
import { LeaveRequest } from '@/types/database';
import { authorize, AuthorizationError } from '@/lib/authorization';
import {
  canActOnLeaveRequest,
} from '@/lib/hr/manager-scope';
import {
  resolveActorContext,
  assertPortalFeatureForRequest,
  blockPortalAdminAction,
} from '@/lib/employee-portal/portal-api-guard';
import { FeatureAccessDeniedError } from '@/lib/subscription/feature-access';
import { syncApprovedLeaveToAttendance } from '@/lib/hr/leave-attendance-sync';
import {
  decideLeaveRequestApproval,
  listLeaveRequestApprovals,
} from '@/lib/hr/leave/leave-request-approval';

export const dynamic = 'force-dynamic';

/**
 * PATCH /api/employees/leave-requests/[id]
 * Update leave request (approve, reject, cancel)
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const requestId = params.id;
    const body = await request.json();
    const actor = await resolveActorContext(request, body);
    let businessId =
      getSessionScopedBusinessId(request) ?? getBusinessIdFromRequest(request);
    if (actor) {
      businessId = actor.businessId;
    }

    if (!businessId) {
      return NextResponse.json(
        { error: 'business_id is required' },
        { status: 400 }
      );
    }

    const { action, approved_by, rejection_reason, hold_reason, comments } = body;
    const updated_by_user_id = body.updated_by_user_id ?? actor?.userId;

    if (!action || !['approve', 'reject', 'cancel', 'hold', 'grant_exception'].includes(action)) {
      return NextResponse.json(
        { error: 'action must be approve, reject, cancel, hold, or grant_exception' },
        { status: 400 }
      );
    }

    if (!updated_by_user_id) {
      return NextResponse.json(
        { error: 'updated_by_user_id is required for authorization' },
        { status: 400 }
      );
    }

    if (actor?.isPortal) {
      try {
        await assertPortalFeatureForRequest(request, actor.businessId, 'leaves');
      } catch (error) {
        if (error instanceof FeatureAccessDeniedError) return error.toNextResponse();
        throw error;
      }
      const blocked = blockPortalAdminAction(actor, action, ['cancel', 'approve', 'reject', 'hold', 'grant_exception']);
      if (blocked) return blocked;
    }

    // Get leave request
    const leaveRequest = await queryOne<
      LeaveRequest & {
        business_id: string;
        employee_id: string;
        leave_name?: string;
      }
    >(
      `SELECT lr.*, e.business_id, e.id as employee_id, lt.leave_name
       FROM leave_requests lr
       INNER JOIN employees e ON lr.employee_id = e.id
       LEFT JOIN leave_types lt ON lr.leave_type_id = lt.id
       WHERE lr.id = $1 AND e.business_id = $2`,
      [requestId, businessId]
    );

    if (!leaveRequest) {
      return NextResponse.json(
        { error: 'Leave request not found' },
        { status: 404 }
      );
    }

    // AUTHORIZATION
    if (action === 'cancel') {
      if (updated_by_user_id !== leaveRequest.employee_id) {
        try {
          await authorize(updated_by_user_id, 'leave_requests', 'update', {
            businessId,
            resourceId: requestId,
          });
        } catch (error) {
          if (error instanceof AuthorizationError) return error.toNextResponse();
          throw error;
        }
      }
    } else if (action === 'approve' || action === 'reject' || action === 'hold' || action === 'grant_exception') {
      const chainRows = await listLeaveRequestApprovals(requestId);
      if (chainRows.length > 0) {
        const chainAction =
          action === 'approve'
            ? 'approve'
            : action === 'reject'
              ? 'reject'
              : action === 'hold'
                ? 'hold'
                : 'grant_exception';
        const chainResult = await decideLeaveRequestApproval({
          leaveRequestId: requestId,
          businessId,
          actorUserId: updated_by_user_id,
          action: chainAction,
          hold_reason,
          comments: rejection_reason ?? comments,
        });
        if (!chainResult.ok) {
          return NextResponse.json({ error: chainResult.message }, { status: 400 });
        }
        const updated = await queryOne<LeaveRequest>(
          `SELECT lr.* FROM leave_requests lr
           INNER JOIN employees e ON lr.employee_id = e.id
           WHERE lr.id = $1 AND e.business_id = $2`,
          [requestId, businessId],
        );
        return NextResponse.json({ request: updated });
      }

      const allowed = await canActOnLeaveRequest(
        updated_by_user_id,
        requestId,
        businessId
      );
      if (!allowed) {
        return NextResponse.json(
          { error: 'Not authorized to act on this leave request' },
          { status: 403 }
        );
      }
    }

    // Validate action based on current status
    if (action === 'approve') {
      if (leaveRequest.status !== 'pending') {
        return NextResponse.json(
          { error: 'Only pending requests can be approved' },
          { status: 400 }
        );
      }

      await query(
        `UPDATE leave_requests lr
         SET status = 'approved', approved_by = $1, approved_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
         FROM employees e
         WHERE lr.id = $2 AND lr.employee_id = e.id AND e.business_id = $3`,
        [approved_by || null, requestId, businessId]
      );

      await syncApprovedLeaveToAttendance({
        businessId,
        employeeId: leaveRequest.employee_id,
        leaveRequestId: requestId,
        startDate: String(leaveRequest.start_date).slice(0, 10),
        endDate: String(leaveRequest.end_date).slice(0, 10),
        totalDays: Number(leaveRequest.total_days),
        leaveName: leaveRequest.leave_name,
      });
    } else if (action === 'reject') {
      if (leaveRequest.status !== 'pending') {
        return NextResponse.json(
          { error: 'Only pending requests can be rejected' },
          { status: 400 }
        );
      }

      await query(
        `UPDATE leave_requests lr
         SET status = 'rejected', approved_by = $1, rejection_reason = $2, rejected_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
         FROM employees e
         WHERE lr.id = $3 AND lr.employee_id = e.id AND e.business_id = $4`,
        [approved_by || null, rejection_reason || null, requestId, businessId]
      );
    } else if (action === 'cancel') {
      if (leaveRequest.status === 'approved') {
        return NextResponse.json(
          { error: 'Approved requests cannot be cancelled. Please contact admin.' },
          { status: 400 }
        );
      }

      if (leaveRequest.status === 'cancelled') {
        return NextResponse.json(
          { error: 'Request is already cancelled' },
          { status: 400 }
        );
      }

      await query(
        `UPDATE leave_requests lr
         SET status = 'cancelled', cancelled_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
         FROM employees e
         WHERE lr.id = $1 AND lr.employee_id = e.id AND e.business_id = $2`,
        [requestId, businessId]
      );
    }

    const updated = await queryOne<LeaveRequest>(
      `SELECT lr.* FROM leave_requests lr
       INNER JOIN employees e ON lr.employee_id = e.id
       WHERE lr.id = $1 AND e.business_id = $2`,
      [requestId, businessId]
    );

    return NextResponse.json({ request: updated });
  } catch (error: any) {
    console.error('Error updating leave request:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/employees/leave-requests/[id]
 * Delete a leave request (only if pending or cancelled)
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const requestId = params.id;
    const { searchParams } = new URL(request.url);
    const businessId =
      getSessionScopedBusinessId(request) ?? getBusinessIdFromRequest(request);
    const userId = getUserIdFromRequest(request); // REQUIRED for authorization

    if (!businessId) {
      return NextResponse.json(
        { error: 'business_id is required' },
        { status: 400 }
      );
    }

    if (!userId) {
      return NextResponse.json(
        { error: 'user_id is required for authorization' },
        { status: 400 }
      );
    }

    // Get leave request
    const leaveRequest = await queryOne<LeaveRequest & { business_id: string }>(
      `SELECT lr.*, e.business_id
       FROM leave_requests lr
       INNER JOIN employees e ON lr.employee_id = e.id
       WHERE lr.id = $1 AND e.business_id = $2`,
      [requestId, businessId]
    );

    if (!leaveRequest) {
      return NextResponse.json(
        { error: 'Leave request not found' },
        { status: 404 }
      );
    }

    // AUTHORIZATION: Check delete permission
    try {
      await authorize(userId, 'leave_requests', 'delete', { businessId, resourceId: requestId });
    } catch (error) {
      if (error instanceof AuthorizationError) {
        return error.toNextResponse();
      }
      throw error;
    }

    // Only allow deletion of pending or cancelled requests
    if (leaveRequest.status === 'approved' || leaveRequest.status === 'rejected') {
      return NextResponse.json(
        { error: 'Cannot delete approved or rejected requests' },
        { status: 400 }
      );
    }

    await query(
      `DELETE FROM leave_requests lr
       USING employees e
       WHERE lr.id = $1 AND lr.employee_id = e.id AND e.business_id = $2`,
      [requestId, businessId]
    );

    return NextResponse.json({ message: 'Leave request deleted successfully' });
  } catch (error: any) {
    console.error('Error deleting leave request:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}

