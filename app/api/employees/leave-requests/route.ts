import { NextRequest, NextResponse } from 'next/server';
import { getUserIdFromRequest, getBusinessIdFromRequest, resolveCreatedByUserId } from '@/lib/auth-helpers';
import { queryRows, queryOne, query } from '@/lib/db';
import { LeaveRequest } from '@/types/database';
import { checkLeaveBalance } from '@/lib/leave-calculator';
import { authorize, AuthorizationError } from '@/lib/authorization';
import {
  canActOnLeaveRequest,
  getDirectReportIds,
  getEmployeeIdForUser,
  resolveListScope,
} from '@/lib/hr/manager-scope';
import {
  resolveActorContext,
  assertPortalFeatureForRequest,
  enforcePortalSelfScope,
} from '@/lib/employee-portal/portal-api-guard';
import { FeatureAccessDeniedError } from '@/lib/subscription/feature-access';
import { limitExceededResponse } from '@/lib/subscription/limit-response';
import { getDefaultPlanBundle, getLeavePlanTypeRule } from '@/lib/hr/leave/leave-plan';
import { validateLeaveApplication, resolveLeaveYearForRequest, shouldAutoApprove } from '@/lib/hr/leave/leave-policy';
import { calculateLeaveDaysWithSandwich } from '@/lib/hr/leave/leave-days';
import { ensureLeaveBalanceRow } from '@/lib/hr/leave/leave-accrual';
import { bootstrapLeaveRequestApprovals } from '@/lib/hr/leave/leave-request-approval';
import { syncApprovedLeaveToAttendance } from '@/lib/hr/leave-attendance-sync';

export const dynamic = 'force-dynamic';

/**
 * GET /api/employees/leave-requests
 * List leave requests
 */
export async function GET(request: NextRequest) {
  try {
    const actor = await resolveActorContext(request);
    if (actor?.isPortal) {
      try {
        await assertPortalFeatureForRequest(request, actor.businessId, 'leaves');
      } catch (error) {
        if (error instanceof FeatureAccessDeniedError) return error.toNextResponse();
        throw error;
      }
    }

    const { searchParams } = new URL(request.url);
    let businessId = getBusinessIdFromRequest(request);
    let userId = getUserIdFromRequest(request);
    if (actor) {
      businessId = actor.businessId;
      if (!userId) userId = actor.userId;
    }
    let employeeId = searchParams.get('employee_id');
    const status = searchParams.get('status');
    const startDate = searchParams.get('start_date');
    const endDate = searchParams.get('end_date');
    const scopeParam = searchParams.get('scope');

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

    // AUTHORIZATION: Employee self-service - allow if user is employee viewing own requests OR has permission
    const { isEmployee } = await import('@/lib/access-boundary');
    const userIsEmployee = await isEmployee(userId);
    
    // If user is employee viewing own leave requests, allow without portal permission
    if (userIsEmployee && employeeId && userId === employeeId) {
      // Self-service access allowed - filter will be applied in SQL
    } else {
      // Portal user or viewing all requests - require permission
      try {
        await authorize(userId, 'leave_requests', 'read', { businessId });
      } catch (error) {
        if (error instanceof AuthorizationError) {
          const actorEmployeeId = await getEmployeeIdForUser(userId, businessId);
          const teamIds = actorEmployeeId
            ? await getDirectReportIds(businessId, actorEmployeeId)
            : [];
          if (teamIds.length === 0) {
            return error.toNextResponse();
          }
        } else {
          throw error;
        }
      }
    }

    const listScope = await resolveListScope(userId, businessId, 'leave', scopeParam);

    let sql = `
      SELECT 
        lr.*,
        lt.leave_name,
        lt.leave_code,
        e.employee_code,
        u.name as employee_name,
        approver.employee_code as approver_code,
        approver_user.name as approver_name
      FROM leave_requests lr
      INNER JOIN leave_types lt ON lr.leave_type_id = lt.id
      INNER JOIN employees e ON lr.employee_id = e.id
      INNER JOIN users u ON e.id = u.id
      LEFT JOIN employees approver ON lr.approved_by = approver.id
      LEFT JOIN users approver_user ON approver.id = approver_user.id
      WHERE e.business_id = $1
    `;
    const params: any[] = [businessId];
    let paramIndex = 2;

    if (employeeId) {
      sql += ` AND lr.employee_id = $${paramIndex}`;
      params.push(employeeId);
      paramIndex++;
    } else if (actor?.isPortal) {
      sql += ` AND lr.employee_id = $${paramIndex}`;
      params.push(actor.userId);
      paramIndex++;
    } else if (listScope === 'team') {
      const actorEmployeeId = await getEmployeeIdForUser(userId, businessId);
      if (actorEmployeeId) {
        const teamIds = await getDirectReportIds(businessId, actorEmployeeId);
        if (teamIds.length === 0) {
          return NextResponse.json({ requests: [] });
        }
        const ph = teamIds.map((_, i) => `$${paramIndex + i}`).join(', ');
        sql += ` AND lr.employee_id IN (${ph})`;
        params.push(...teamIds);
        paramIndex += teamIds.length;
      }
    } else if (listScope === 'self') {
      sql += ` AND lr.employee_id = $${paramIndex}`;
      params.push(userId);
      paramIndex++;
    }

    if (status) {
      sql += ` AND lr.status = $${paramIndex}`;
      params.push(status);
      paramIndex++;
    }

    if (startDate) {
      sql += ` AND lr.start_date >= $${paramIndex}`;
      params.push(startDate);
      paramIndex++;
    }

    if (endDate) {
      sql += ` AND lr.end_date <= $${paramIndex}`;
      params.push(endDate);
      paramIndex++;
    }

    sql += ` ORDER BY lr.created_at DESC LIMIT 100`;

    const requests = await queryRows<LeaveRequest & {
      leave_name: string;
      leave_code: string;
      employee_code: string;
      employee_name: string;
      approver_code?: string;
      approver_name?: string;
    }>(sql, params);

    return NextResponse.json({ requests });
  } catch (error: any) {
    console.error('Error fetching leave requests:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/employees/leave-requests
 * Create a new leave request
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const actor = await resolveActorContext(request, body);
    let {
      business_id,
      employee_id,
      leave_type_id,
      start_date,
      end_date,
      reason,
      attachment_url,
    } = body;

    if (actor) {
      business_id = actor.businessId;
      if (actor.isPortal) {
        try {
          await assertPortalFeatureForRequest(request, actor.businessId, 'leaves');
        } catch (error) {
          if (error instanceof FeatureAccessDeniedError) return error.toNextResponse();
          throw error;
        }
        employee_id = actor.userId;
      }
    }

    if (!business_id || !employee_id || !leave_type_id || !start_date || !end_date) {
      return NextResponse.json(
        { error: 'business_id, employee_id, leave_type_id, start_date, and end_date are required' },
        { status: 400 }
      );
    }

    // Use employee_id as fallback if actor not in body (for self-requests)
    const authUserId = resolveCreatedByUserId(request, body) || employee_id;

    // AUTHORIZATION: Employee self-service - allow if user is employee OR has permission
    const { isEmployee, canAccessEmployeeResource } = await import('@/lib/access-boundary');
    const userIsEmployee = await isEmployee(authUserId);
    
    // If user is employee accessing own leave request, allow without portal permission
    if (userIsEmployee && authUserId === employee_id) {
      // Self-service access allowed
    } else {
      // Portal user or accessing other employee - require permission
      try {
        await authorize(authUserId, 'leave_requests', 'create', { businessId: business_id });
      } catch (error) {
        if (error instanceof AuthorizationError) {
          return error.toNextResponse();
        }
        throw error;
      }
    }

    // Verify employee belongs to business
    const employee = await queryOne(
      'SELECT id FROM employees WHERE id = $1 AND business_id = $2',
      [employee_id, business_id]
    );

    if (!employee) {
      return NextResponse.json(
        { error: 'Employee not found' },
        { status: 404 }
      );
    }

    const { plan } = await getDefaultPlanBundle(business_id);
    const typeRule = await getLeavePlanTypeRule(plan.id, leave_type_id);
    if (!typeRule) {
      return NextResponse.json(
        { error: 'Leave type is not configured in the leave plan' },
        { status: 400 },
      );
    }

    const totalDays = await calculateLeaveDaysWithSandwich(
      start_date,
      end_date,
      business_id,
      typeRule,
    );

    if (totalDays <= 0) {
      return NextResponse.json(
        { error: 'Invalid date range or no working days in the selected period' },
        { status: 400 }
      );
    }

    const isPortalSelfApply = Boolean(actor?.isPortal && authUserId === employee_id);

    try {
      await validateLeaveApplication({
        businessId: business_id,
        employeeId: employee_id,
        leaveTypeId: leave_type_id,
        startDate: start_date,
        endDate: end_date,
        reason,
        attachmentUrl: attachment_url,
        actorUserId: authUserId,
        isPortalSelfApply,
        totalDays,
      });
    } catch (validationError) {
      return NextResponse.json(
        { error: validationError instanceof Error ? validationError.message : 'Validation failed' },
        { status: 400 },
      );
    }

    const leaveYear = resolveLeaveYearForRequest(start_date, plan);
    await ensureLeaveBalanceRow(employee_id, leave_type_id, leaveYear);

    const balanceCheck = await checkLeaveBalance(employee_id, leave_type_id, totalDays, leaveYear);

    if (!balanceCheck.sufficient && !typeRule.allow_negative_balance) {
      return NextResponse.json(
        {
          error: `Insufficient leave balance. Available: ${balanceCheck.currentBalance} days, Required: ${totalDays} days`,
          shortfall: balanceCheck.shortfall,
        },
        { status: 400 }
      );
    }

    const autoApprove = await shouldAutoApprove(typeRule);
    const initialStatus = autoApprove ? 'approved' : 'pending';

    const leaveLimit = await limitExceededResponse(business_id, 'leave_requests');
    if (leaveLimit) return leaveLimit;

    const leaveRequest = await queryOne<LeaveRequest>(
      `INSERT INTO leave_requests (
        employee_id, leave_type_id, start_date, end_date, total_days,
        reason, attachment_url, requested_by, status
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING *`,
      [
        employee_id,
        leave_type_id,
        start_date,
        end_date,
        totalDays,
        reason || null,
        attachment_url || null,
        employee_id,
        initialStatus,
      ]
    );

    if (!leaveRequest) {
      return NextResponse.json({ error: 'Failed to create leave request' }, { status: 500 });
    }

    if (!autoApprove) {
      await bootstrapLeaveRequestApprovals(leaveRequest.id, business_id, employee_id);
    } else {
      await syncApprovedLeaveToAttendance({
        businessId: business_id,
        employeeId: employee_id,
        leaveRequestId: leaveRequest.id,
        startDate: start_date,
        endDate: end_date,
        totalDays,
      });
    }

    return NextResponse.json({ request: leaveRequest }, { status: 201 });
  } catch (error: any) {
    console.error('Error creating leave request:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}

