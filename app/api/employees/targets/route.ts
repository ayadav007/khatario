import { NextRequest, NextResponse } from 'next/server';
import { queryRows, queryOne, query } from '@/lib/db';
import { EmployeeTarget } from '@/types/database';

/**
 * GET /api/employees/targets
 * List employee targets
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const businessId = searchParams.get('business_id');
    const employeeId = searchParams.get('employee_id');
    const targetYear = searchParams.get('target_year');
    const targetMonth = searchParams.get('target_month');

    if (!businessId) {
      return NextResponse.json(
        { error: 'business_id is required' },
        { status: 400 }
      );
    }

    let sql = `
      SELECT 
        et.*,
        e.employee_code,
        u.name as employee_name
      FROM employee_targets et
      INNER JOIN employees e ON et.employee_id = e.id
      INNER JOIN users u ON e.id = u.id
      WHERE e.business_id = $1
    `;
    const params: any[] = [businessId];
    let paramIndex = 2;

    if (employeeId) {
      sql += ` AND et.employee_id = $${paramIndex}`;
      params.push(employeeId);
      paramIndex++;
    }

    if (targetYear) {
      sql += ` AND et.target_year = $${paramIndex}`;
      params.push(parseInt(targetYear));
      paramIndex++;
    }

    if (targetMonth) {
      sql += ` AND et.target_month = $${paramIndex}`;
      params.push(parseInt(targetMonth));
      paramIndex++;
    }

    sql += ` ORDER BY et.target_year DESC, et.target_month DESC, et.created_at DESC`;

    const targets = await queryRows<EmployeeTarget & {
      employee_code: string;
      employee_name: string;
    }>(sql, params);

    return NextResponse.json({ targets });
  } catch (error: any) {
    console.error('Error fetching targets:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/employees/targets
 * Create or update employee target
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      business_id,
      employee_id,
      target_period,
      target_year,
      target_month,
      target_amount,
      target_invoices,
    } = body;

    if (!business_id || !employee_id || !target_period || !target_year || !target_amount) {
      return NextResponse.json(
        { error: 'business_id, employee_id, target_period, target_year, and target_amount are required' },
        { status: 400 }
      );
    }

    // Validate target_period
    if (!['monthly', 'quarterly', 'yearly'].includes(target_period)) {
      return NextResponse.json(
        { error: 'target_period must be monthly, quarterly, or yearly' },
        { status: 400 }
      );
    }

    // Validate target_month for monthly/quarterly
    if (target_period === 'monthly' && !target_month) {
      return NextResponse.json(
        { error: 'target_month is required for monthly targets' },
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

    // Check if target already exists
    const existing = await queryOne(
      'SELECT id FROM employee_targets WHERE employee_id = $1 AND target_period = $2 AND target_year = $3 AND target_month = $4',
      [employee_id, target_period, target_year, target_month || null]
    );

    let target: EmployeeTarget;

    if (existing) {
      // Update existing target
      await query(
        `UPDATE employee_targets
         SET target_amount = $1, target_invoices = $2, updated_at = CURRENT_TIMESTAMP
         WHERE id = $3`,
        [target_amount, target_invoices || null, existing.id]
      );

      const updatedTarget = await queryOne<EmployeeTarget>(
        'SELECT * FROM employee_targets WHERE id = $1',
        [existing.id]
      );
      if (!updatedTarget) {
        return NextResponse.json(
          { error: 'Failed to update target' },
          { status: 500 }
        );
      }
      target = updatedTarget;
    } else {
      // Create new target
      const newTarget = await queryOne<EmployeeTarget>(
        `INSERT INTO employee_targets (
          employee_id, target_period, target_year, target_month, target_amount, target_invoices
        )
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING *`,
        [
          employee_id,
          target_period,
          target_year,
          target_month || null,
          target_amount,
          target_invoices || null,
        ]
      );
      if (!newTarget) {
        return NextResponse.json(
          { error: 'Failed to create target' },
          { status: 500 }
        );
      }
      target = newTarget;
    }

    return NextResponse.json({ target }, { status: existing ? 200 : 201 });
  } catch (error: any) {
    console.error('Error creating/updating target:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}

