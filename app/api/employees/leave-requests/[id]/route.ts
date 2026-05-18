import { NextRequest, NextResponse } from 'next/server';
import { getBusinessIdFromRequest, getSessionScopedBusinessId, getUserIdFromRequest } from '@/lib/auth-helpers';
import { queryOne, query } from '@/lib/db';
import { LeaveRequest } from '@/types/database';
import { authorize, AuthorizationError } from '@/lib/authorization';

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
    const { searchParams } = new URL(request.url);
    const businessId =
      getSessionScopedBusinessId(request) ?? getBusinessIdFromRequest(request);
    const body = await request.json();

    if (!businessId) {
      return NextResponse.json(
        { error: 'business_id is required' },
        { status: 400 }
      );
    }

    const { action, approved_by, rejection_reason, updated_by_user_id } = body;

    if (!action || !['approve', 'reject', 'cancel'].includes(action)) {
      return NextResponse.json(
        { error: 'action must be approve, reject, or cancel' },
        { status: 400 }
      );
    }

    if (!updated_by_user_id) {
      return NextResponse.json(
        { error: 'updated_by_user_id is required for authorization' },
        { status: 400 }
      );
    }

    // Get leave request
    const leaveRequest = await queryOne<LeaveRequest & { business_id: string; employee_id: string }>(
      `SELECT lr.*, e.business_id, e.id as employee_id
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

    // AUTHORIZATION: Check update permission (for approve/reject/cancel)
    // For cancel action, allow employee to cancel their own request
    const authAction = action === 'cancel' ? 'update' : (action === 'approve' || action === 'reject' ? 'update' : 'update');
    try {
      await authorize(updated_by_user_id, 'leave_requests', authAction, { businessId, resourceId: requestId });
    } catch (error) {
      if (error instanceof AuthorizationError) {
        return error.toNextResponse();
      }
      throw error;
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

