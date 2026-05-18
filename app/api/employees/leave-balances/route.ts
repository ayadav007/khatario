import { NextRequest, NextResponse } from 'next/server';
import { getUserIdFromRequest, getBusinessIdFromRequest, resolveCreatedByUserId } from '@/lib/auth-helpers';
import { queryRows, queryOne, query } from '@/lib/db';
import { LeaveBalance } from '@/types/database';
import { authorize, AuthorizationError } from '@/lib/authorization';

/**
 * GET /api/employees/leave-balances
 * Get leave balances for employees
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const businessId = getBusinessIdFromRequest(request);
    const userId = getUserIdFromRequest(request); // REQUIRED for authorization
    const employeeId = searchParams.get('employee_id');
    const year = searchParams.get('year') || new Date().getFullYear().toString();

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

    // AUTHORIZATION: Employee self-service - allow if user is employee viewing own balance OR has permission
    const { isEmployee } = await import('@/lib/access-boundary');
    const userIsEmployee = await isEmployee(userId);
    
    // If user is employee viewing own leave balance, allow without portal permission
    if (userIsEmployee && employeeId && userId === employeeId) {
      // Self-service access allowed - filter will be applied in SQL
    } else {
      // Portal user or viewing all balances - require permission
      try {
        await authorize(userId, 'leave_requests', 'read', { businessId });
      } catch (error) {
        if (error instanceof AuthorizationError) {
          return error.toNextResponse();
        }
        throw error;
      }
    }

    let sql = `
      SELECT 
        lb.*,
        lt.leave_name,
        lt.leave_code,
        lt.max_days_per_year,
        lt.carry_forward,
        lt.max_carry_forward_days
      FROM leave_balances lb
      INNER JOIN leave_types lt ON lb.leave_type_id = lt.id
      INNER JOIN employees e ON lb.employee_id = e.id
      WHERE e.business_id = $1 AND lb.year = $2
    `;
    const params: any[] = [businessId, parseInt(year)];

    if (employeeId) {
      sql += ` AND lb.employee_id = $3`;
      params.push(employeeId);
    }

    sql += ` ORDER BY lt.leave_name ASC`;

    const balances = await queryRows<LeaveBalance & {
      leave_name: string;
      leave_code: string;
      max_days_per_year?: number;
      carry_forward: boolean;
      max_carry_forward_days?: number;
    }>(sql, params);

    return NextResponse.json({ balances });
  } catch (error: any) {
    console.error('Error fetching leave balances:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/employees/leave-balances
 * Initialize or update leave balance for an employee
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      business_id,
      employee_id,
      leave_type_id,
      year,
      opening_balance = 0,
      earned_days = 0,
    } = body;
    const createdByUserId = resolveCreatedByUserId(request, body);

    if (!business_id || !employee_id || !leave_type_id || !year) {
      return NextResponse.json(
        { error: 'business_id, employee_id, leave_type_id, and year are required' },
        { status: 400 }
      );
    }

    if (!createdByUserId) {
      return NextResponse.json(
        { error: 'created_by_user_id is required for authorization' },
        { status: 400 }
      );
    }

    // AUTHORIZATION: Check create permission (leave balances are part of HR module)
    try {
      await authorize(createdByUserId, 'leave_requests', 'create', { businessId: business_id });
    } catch (error) {
      if (error instanceof AuthorizationError) {
        return error.toNextResponse();
      }
      throw error;
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

    // Check if balance already exists
    const existing = await queryOne(
      'SELECT id FROM leave_balances WHERE employee_id = $1 AND leave_type_id = $2 AND year = $3',
      [employee_id, leave_type_id, year]
    );

    let balance: LeaveBalance;

    if (existing) {
      // Update existing balance
      await query(
        `UPDATE leave_balances
         SET opening_balance = $1, earned_days = $2,
             current_balance = $1 + $2 + carry_forward_days - used_days,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $3`,
        [opening_balance, earned_days, existing.id]
      );

      const updatedBalance = await queryOne<LeaveBalance>(
        'SELECT * FROM leave_balances WHERE id = $1',
        [existing.id]
      );
      if (!updatedBalance) {
        return NextResponse.json(
          { error: 'Failed to update leave balance' },
          { status: 500 }
        );
      }
      balance = updatedBalance;
    } else {
      // Create new balance
      const newBalance = await queryOne<LeaveBalance>(
        `INSERT INTO leave_balances (
          employee_id, leave_type_id, year, opening_balance, earned_days, current_balance
        )
        VALUES ($1, $2, $3, $4, $5, $4 + $5)
        RETURNING *`,
        [employee_id, leave_type_id, year, opening_balance, earned_days]
      );
      if (!newBalance) {
        return NextResponse.json(
          { error: 'Failed to create leave balance' },
          { status: 500 }
        );
      }
      balance = newBalance;
    }

    return NextResponse.json({ balance }, { status: existing ? 200 : 201 });
  } catch (error: any) {
    console.error('Error creating/updating leave balance:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}

