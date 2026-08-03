import { NextRequest, NextResponse } from 'next/server';
import { queryRows } from '@/lib/db';
import { authorize, AuthorizationError } from '@/lib/authorization';
import {
  getDirectReportIds,
  isReportingManager,
  canApproveForEmployee,
} from '@/lib/hr/manager-scope';
import { getHrApprovalSettings } from '@/lib/hr/hr-approval-settings';
import { resolveActorContext } from '@/lib/employee-portal/portal-api-guard';
import { listPendingExitApprovalsForUser } from '@/lib/hr/exit-approval';
import { listPendingLeaveChainApprovalsForUser } from '@/lib/hr/leave/leave-request-approval';
import { listPendingOtApprovalsForUser } from '@/lib/hr/shift-overtime/ot-request-approval';
import { listPendingRegularizationsForManager } from '@/lib/hr/attendance-regularization';

export const dynamic = 'force-dynamic';

/**
 * GET /api/employees/manager/pending-approvals
 * Leave/expense for direct-report managers; exit resignations for chain approvers + dept heads.
 */
export async function GET(request: NextRequest) {
  try {
    const actor = await resolveActorContext(request);
    if (!actor) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    const employeeId = actor.userId;
    const businessId = actor.businessId;

    const exits = await listPendingExitApprovalsForUser(businessId, employeeId);
    const leaveChain = await listPendingLeaveChainApprovalsForUser(businessId, employeeId);
    const otChain = await listPendingOtApprovalsForUser(businessId, employeeId);
    const regularizations = await listPendingRegularizationsForManager(businessId, employeeId);
    const isManager = await isReportingManager(employeeId);

    let filteredLeaves: Array<{
      id: string;
      employee_id: string;
      employee_code: string;
      employee_name: string;
      leave_name: string;
      start_date: string;
      end_date: string;
      total_days: number;
      status: string;
      reason: string | null;
      created_at: string;
    }> = [];
    let filteredExpenses: Array<{
      id: string;
      employee_id: string;
      employee_code: string;
      employee_name: string;
      amount: number;
      description: string;
      expense_date: string;
      status: string;
      submitted_at: string;
    }> = [];

    if (isManager) {
      if (!actor.isPortal) {
        try {
          await authorize(actor.userId, 'leave_requests', 'read', { businessId });
        } catch (error) {
          if (!(error instanceof AuthorizationError)) throw error;
        }
      }

      const teamIds = await getDirectReportIds(businessId, employeeId);
      if (teamIds.length > 0) {
        const settings = await getHrApprovalSettings(businessId);
        const placeholders = teamIds.map((_, i) => `$${i + 2}`).join(', ');

        const leaves = await queryRows<{
          id: string;
          employee_id: string;
          employee_code: string;
          employee_name: string;
          leave_name: string;
          start_date: string;
          end_date: string;
          total_days: number;
          status: string;
          reason: string | null;
          created_at: string;
        }>(
          `SELECT lr.id, lr.employee_id, e.employee_code, u.name AS employee_name,
                  lt.leave_name, lr.start_date, lr.end_date, lr.total_days, lr.status,
                  lr.reason, lr.created_at
           FROM leave_requests lr
           INNER JOIN employees e ON lr.employee_id = e.id
           INNER JOIN users u ON u.id = e.id
           INNER JOIN leave_types lt ON lt.id = lr.leave_type_id
           WHERE e.business_id = $1 AND lr.status = 'pending'
             AND lr.employee_id IN (${placeholders})
           ORDER BY lr.created_at DESC`,
          [businessId, ...teamIds],
        );

        const expenses = await queryRows<{
          id: string;
          employee_id: string;
          employee_code: string;
          employee_name: string;
          amount: number;
          description: string;
          expense_date: string;
          status: string;
          submitted_at: string;
        }>(
          `SELECT ee.id, ee.employee_id, e.employee_code, u.name AS employee_name,
                  ee.amount, ee.description, ee.expense_date, ee.status, ee.submitted_at
           FROM employee_expenses ee
           INNER JOIN employees e ON ee.employee_id = e.id
           INNER JOIN users u ON u.id = e.id
           WHERE e.business_id = $1 AND ee.status = 'pending'
             AND ee.employee_id IN (${placeholders})
           ORDER BY ee.submitted_at DESC`,
          [businessId, ...teamIds],
        );

        for (const l of leaves) {
          if (await canApproveForEmployee(actor.userId, businessId, l.employee_id, 'leave', settings)) {
            filteredLeaves.push(l);
          }
        }

        for (const exp of expenses) {
          if (
            await canApproveForEmployee(actor.userId, businessId, exp.employee_id, 'expense', settings)
          ) {
            filteredExpenses.push(exp);
          }
        }

      }
    }

    let filteredOt: Array<{
      id: string;
      employee_id: string;
      employee_code: string;
      employee_name: string;
      request_date: string;
      total_hours: number;
      reason: string | null;
      status: string;
    }> = [];

    if (isManager) {
      const teamIds = await getDirectReportIds(businessId, employeeId);
      if (teamIds.length > 0) {
        const settings = await getHrApprovalSettings(businessId);
        const placeholders = teamIds.map((_, i) => `$${i + 2}`).join(', ');

        const otRows = await queryRows<{
          id: string;
          employee_id: string;
          employee_code: string;
          employee_name: string;
          request_date: string;
          total_hours: number;
          reason: string | null;
          status: string;
        }>(
          `SELECT o.id, o.employee_id, e.employee_code, u.name AS employee_name,
                  o.request_date::text, o.total_hours, o.reason, o.status
           FROM overtime_requests o
           INNER JOIN employees e ON o.employee_id = e.id
           INNER JOIN users u ON u.id = e.id
           WHERE e.business_id = $1 AND o.status = 'pending'
             AND o.employee_id IN (${placeholders})
             AND NOT EXISTS (SELECT 1 FROM overtime_request_approvals a WHERE a.overtime_request_id = o.id)
           ORDER BY o.created_at DESC`,
          [businessId, ...teamIds],
        );

        for (const o of otRows) {
          if (await canApproveForEmployee(actor.userId, businessId, o.employee_id, 'leave', settings)) {
            filteredOt.push(o);
          }
        }
      }
    }

    if (
      !isManager &&
      exits.length === 0 &&
      leaveChain.length === 0 &&
      otChain.length === 0 &&
      filteredOt.length === 0 &&
      regularizations.length === 0
    ) {
      return NextResponse.json({ error: 'No pending approvals for you' }, { status: 403 });
    }

    return NextResponse.json({
      leaves: filteredLeaves,
      expenses: filteredExpenses,
      exits,
      leave_chain: leaveChain,
      ot_chain: otChain,
      overtime: filteredOt,
      regularizations,
    });
  } catch (error: unknown) {
    console.error('Error fetching pending approvals:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 },
    );
  }
}
