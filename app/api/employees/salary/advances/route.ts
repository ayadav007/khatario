import { NextRequest, NextResponse } from 'next/server';
import { getUserIdFromRequest, getBusinessIdFromRequest, getSessionScopedBusinessId } from '@/lib/auth-helpers';
import { queryRows, queryOne, query } from '@/lib/db';
import { SalaryAdvance } from '@/types/database';
import { authorize, AuthorizationError } from '@/lib/authorization';
import { limitExceededResponse } from '@/lib/subscription/limit-response';

/**
 * GET /api/employees/salary/advances
 * List salary advances
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const businessId = getBusinessIdFromRequest(request);
    const userId = getUserIdFromRequest(request); // REQUIRED for authorization
    const employeeId = searchParams.get('employee_id');
    const status = searchParams.get('status');

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

    // AUTHORIZATION: Check read permission (salary advances are part of HR module)
    try {
      await authorize(userId, 'payroll', 'read', { businessId });
    } catch (error) {
      if (error instanceof AuthorizationError) {
        return error.toNextResponse();
      }
      throw error;
    }

    let sql = `
      SELECT 
        sa.*,
        u.name as employee_name,
        e.employee_code
      FROM salary_advances sa
      JOIN employees e ON sa.employee_id = e.id
      JOIN users u ON e.id = u.id
      WHERE sa.business_id = $1
    `;
    const params: any[] = [businessId];
    let paramIndex = 2;

    if (employeeId) {
      sql += ` AND sa.employee_id = $${paramIndex}`;
      params.push(employeeId);
      paramIndex++;
    }

    if (status) {
      sql += ` AND sa.status = $${paramIndex}`;
      params.push(status);
      paramIndex++;
    }

    sql += ` ORDER BY sa.created_at DESC`;

    const advances = await queryRows<SalaryAdvance & {
      employee_name: string;
      employee_code: string;
    }>(sql, params);

    return NextResponse.json({ advances });
  } catch (error: any) {
    console.error('Error fetching salary advances:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/employees/salary/advances
 * Request a new salary advance
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const business_id = getSessionScopedBusinessId(request);

    const {
      employee_id,
      advance_amount,
      advance_date,
      reason,
      recovery_method = 'salary_deduction',
      recovery_months,
      requested_by,
    } = body;

    if (!business_id || !employee_id || !advance_amount || !advance_date) {
      return NextResponse.json(
        { error: 'Active business scope, employee_id, advance_amount, and advance_date are required' },
        { status: 400 }
      );
    }

    // Use requested_by as fallback if not provided (for self-request)
    const authUserId = requested_by || employee_id;

    // AUTHORIZATION: Check create permission (salary advances are part of HR module)
    try {
      await authorize(authUserId, 'payroll', 'create', { businessId: business_id });
    } catch (error) {
      if (error instanceof AuthorizationError) {
        return error.toNextResponse();
      }
      throw error;
    }

    if (Number(advance_amount) <= 0) {
      return NextResponse.json(
        { error: 'Advance amount must be greater than 0' },
        { status: 400 }
      );
    }

    const advanceLimit = await limitExceededResponse(business_id, 'salary_advances');
    if (advanceLimit) return advanceLimit;

    const advance = await queryOne<SalaryAdvance>(
      `INSERT INTO salary_advances (
        business_id, employee_id, advance_amount, advance_date, reason,
        recovery_method, recovery_months, remaining_amount, requested_by, status
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      RETURNING *`,
      [
        business_id,
        employee_id,
        advance_amount,
        advance_date,
        reason || null,
        recovery_method,
        recovery_months || null,
        advance_amount, // Initially, remaining = advance_amount
        requested_by || null,
        'pending',
      ]
    );

    return NextResponse.json({ advance }, { status: 201 });
  } catch (error: any) {
    console.error('Error creating salary advance:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}

