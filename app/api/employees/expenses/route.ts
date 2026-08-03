import { NextRequest, NextResponse } from 'next/server';
import { getUserIdFromRequest, getBusinessIdFromRequest, resolveCreatedByUserId } from '@/lib/auth-helpers';
import { queryRows, queryOne, query } from '@/lib/db';
import { EmployeeExpense } from '@/types/database';
import { authorize, AuthorizationError } from '@/lib/authorization';
import { limitExceededResponse } from '@/lib/subscription/limit-response';
import {
  getDirectReportIds,
  getEmployeeIdForUser,
  resolveListScope,
} from '@/lib/hr/manager-scope';
import {
  resolveActorContext,
  assertPortalFeatureForRequest,
  enforcePortalSelfScope,
} from '@/lib/employee-portal/portal-api-guard';
import { assertFeatureAccess, FeatureAccessDeniedError } from '@/lib/subscription/feature-access';

export const dynamic = 'force-dynamic';

/**
 * GET /api/employees/expenses
 * List employee expenses
 */
export async function GET(request: NextRequest) {
  try {
    const actor = await resolveActorContext(request);
    const { searchParams } = new URL(request.url);
    let businessId = getBusinessIdFromRequest(request);
    let userId = getUserIdFromRequest(request);
    if (actor) {
      businessId = actor.businessId;
      userId = actor.userId;
    }
    let employeeId = searchParams.get('employee_id');
    const status = searchParams.get('status');
    const categoryId = searchParams.get('category_id');
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

    if (actor?.isPortal) {
      try {
        await assertPortalFeatureForRequest(request, actor.businessId, 'expenses');
      } catch (error) {
        if (error instanceof FeatureAccessDeniedError) return error.toNextResponse();
        throw error;
      }
      employeeId = enforcePortalSelfScope(actor, employeeId);
    }

    const { isEmployee } = await import('@/lib/access-boundary');
    const userIsEmployee = await isEmployee(userId);

    if (userIsEmployee && employeeId && userId === employeeId) {
      // Self-service
    } else {
      try {
        await authorize(userId, 'expenses', 'read', { businessId });
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

    const listScope = await resolveListScope(userId, businessId, 'expense', scopeParam);

    let sql = `
      SELECT 
        e.*,
        emp.employee_code,
        u.name as employee_name,
        ec.name AS category_name,
        approver.employee_code as approver_code,
        approver_user.name as approver_name
      FROM employee_expenses e
      INNER JOIN employees emp ON e.employee_id = emp.id
      INNER JOIN users u ON emp.id = u.id
      LEFT JOIN expense_categories ec ON e.expense_category_id = ec.id
      LEFT JOIN employees approver ON e.approved_by = approver.id
      LEFT JOIN users approver_user ON approver.id = approver_user.id
      WHERE emp.business_id = $1
    `;
    const params: any[] = [businessId];
    let paramIndex = 2;

    if (employeeId) {
      sql += ` AND e.employee_id = $${paramIndex}`;
      params.push(employeeId);
      paramIndex++;
    } else if (listScope === 'team') {
      const actorEmployeeId = await getEmployeeIdForUser(userId, businessId);
      if (actorEmployeeId) {
        const teamIds = await getDirectReportIds(businessId, actorEmployeeId);
        if (teamIds.length === 0) {
          return NextResponse.json({ expenses: [], totals: { pending: 0, approved: 0, reimbursed: 0, total: 0 } });
        }
        const ph = teamIds.map((_, i) => `$${paramIndex + i}`).join(', ');
        sql += ` AND e.employee_id IN (${ph})`;
        params.push(...teamIds);
        paramIndex += teamIds.length;
      }
    } else if (listScope === 'self') {
      sql += ` AND e.employee_id = $${paramIndex}`;
      params.push(userId);
      paramIndex++;
    }

    if (status) {
      sql += ` AND e.status = $${paramIndex}`;
      params.push(status);
      paramIndex++;
    }

    if (categoryId) {
      sql += ` AND e.expense_category_id = $${paramIndex}`;
      params.push(categoryId);
      paramIndex++;
    }

    if (startDate) {
      sql += ` AND e.expense_date >= $${paramIndex}`;
      params.push(startDate);
      paramIndex++;
    }

    if (endDate) {
      sql += ` AND e.expense_date <= $${paramIndex}`;
      params.push(endDate);
      paramIndex++;
    }

    sql += ` ORDER BY e.expense_date DESC, e.submitted_at DESC LIMIT 100`;

    const expenses = await queryRows<EmployeeExpense & {
      employee_code: string;
      employee_name: string;
      category_name?: string;
      approver_code?: string;
      approver_name?: string;
    }>(sql, params);

    // Calculate totals
    const totals = expenses.reduce(
      (acc, exp) => {
        if (exp.status === 'pending') acc.pending += exp.amount;
        if (exp.status === 'approved') acc.approved += exp.amount;
        if (exp.status === 'reimbursed') acc.reimbursed += exp.amount;
        acc.total += exp.amount;
        return acc;
      },
      { pending: 0, approved: 0, reimbursed: 0, total: 0 }
    );

    return NextResponse.json({ expenses, totals });
  } catch (error: any) {
    console.error('Error fetching expenses:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/employees/expenses
 * Submit a new expense
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const actor = await resolveActorContext(request, body);
    let {
      business_id,
      employee_id,
      expense_category_id,
      expense_date,
      amount,
      currency = 'INR',
      description,
      payment_mode,
      vendor_name,
      receipt_url,
      is_billable = false,
      billable_to_customer_id,
      billable_to_project,
    } = body;

    if (actor) {
      business_id = actor.businessId;
      if (actor.isPortal) {
        try {
          await assertPortalFeatureForRequest(request, actor.businessId, 'expenses');
        } catch (error) {
          if (error instanceof FeatureAccessDeniedError) return error.toNextResponse();
          throw error;
        }
        employee_id = actor.userId;
      }
    }

    if (!business_id || !employee_id || !expense_date || !amount || !description) {
      return NextResponse.json(
        { error: 'business_id, employee_id, expense_date, amount, and description are required' },
        { status: 400 }
      );
    }

    // Use employee_id as fallback if actor not in body (for self-submission)
    const authUserId = resolveCreatedByUserId(request, body) || employee_id;

    // AUTHORIZATION: Employee self-service - allow if user is employee submitting own expense OR has permission
    const { isEmployee } = await import('@/lib/access-boundary');
    const userIsEmployee = await isEmployee(authUserId);
    
    // If user is employee submitting own expense, allow without portal permission
    // Employee expense claims are self-service and should NOT require subscription features
    if (userIsEmployee && authUserId === employee_id) {
      // Self-service access allowed - no subscription feature check needed
    } else {
      // Portal user or submitting for other employee - require permission and subscription
      try {
        await authorize(authUserId, 'expenses', 'create', { businessId: business_id });
      } catch (error) {
        if (error instanceof AuthorizationError) {
          return error.toNextResponse();
        }
        throw error;
      }

      // CRITICAL: Enforce subscription feature access (only for portal users)
      try {
        await assertFeatureAccess(business_id, 'expense_tracking');
      } catch (error) {
        if (error instanceof FeatureAccessDeniedError) {
          return error.toNextResponse();
        }
        throw error;
      }
    }

    // Validate amount
    if (amount <= 0) {
      return NextResponse.json(
        { error: 'Amount must be greater than 0' },
        { status: 400 }
      );
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

    // Verify category if provided
    if (expense_category_id) {
      const category = await queryOne(
        'SELECT id FROM expense_categories WHERE id = $1 AND business_id = $2',
        [expense_category_id, business_id]
      );

      if (!category) {
        return NextResponse.json(
          { error: 'Expense category not found' },
          { status: 404 }
        );
      }
    }

    const expenseLimit = await limitExceededResponse(business_id, 'employee_expenses');
    if (expenseLimit) return expenseLimit;

    // Create expense
    const expense = await queryOne<EmployeeExpense>(
      `INSERT INTO employee_expenses (
        employee_id, expense_category_id, expense_date, amount, currency,
        description, payment_mode, vendor_name, receipt_url, is_billable,
        billable_to_customer_id, billable_to_project, status
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'pending')
      RETURNING *`,
      [
        employee_id,
        expense_category_id || null,
        expense_date,
        amount,
        currency,
        description,
        payment_mode || null,
        vendor_name || null,
        receipt_url || null,
        is_billable,
        billable_to_customer_id || null,
        billable_to_project || null,
      ]
    );

    return NextResponse.json({ expense }, { status: 201 });
  } catch (error: any) {
    console.error('Error creating expense:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}

