import { NextRequest, NextResponse } from 'next/server';
import { getUserIdFromRequest, getBusinessIdFromRequest } from '@/lib/auth-helpers';
import { queryRows, queryOne, query } from '@/lib/db';
import { CommissionEarning } from '@/types/database';
import { authorize, AuthorizationError } from '@/lib/authorization';

/**
 * GET /api/employees/commissions
 * List commission earnings for employees
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const businessId = getBusinessIdFromRequest(request);
    const userId = getUserIdFromRequest(request); // REQUIRED for authorization
    const employeeId = searchParams.get('employee_id');
    const status = searchParams.get('status'); // 'pending', 'approved', 'paid', 'cancelled'
    const startDate = searchParams.get('start_date');
    const endDate = searchParams.get('end_date');

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

    // AUTHORIZATION: Check read permission (commissions are part of HR module)
    try {
      await authorize(userId, 'commissions', 'read', { businessId });
    } catch (error) {
      if (error instanceof AuthorizationError) {
        return error.toNextResponse();
      }
      throw error;
    }

    let sql = `
      SELECT 
        ce.*,
        e.employee_code,
        u.name as employee_name,
        i.invoice_number,
        i.invoice_date,
        i.grand_total as invoice_total
      FROM commission_earnings ce
      INNER JOIN employees emp ON ce.employee_id = emp.id
      INNER JOIN employees e ON ce.employee_id = e.id
      INNER JOIN users u ON e.id = u.id
      INNER JOIN invoices i ON ce.invoice_id = i.id
      WHERE emp.business_id = $1
    `;
    const params: any[] = [businessId];
    let paramIndex = 2;

    if (employeeId) {
      sql += ` AND ce.employee_id = $${paramIndex}`;
      params.push(employeeId);
      paramIndex++;
    }

    if (status) {
      sql += ` AND ce.status = $${paramIndex}`;
      params.push(status);
      paramIndex++;
    }

    if (startDate) {
      sql += ` AND i.invoice_date >= $${paramIndex}`;
      params.push(startDate);
      paramIndex++;
    }

    if (endDate) {
      sql += ` AND i.invoice_date <= $${paramIndex}`;
      params.push(endDate);
      paramIndex++;
    }

    sql += ` ORDER BY ce.created_at DESC LIMIT 100`;

    const commissions = await queryRows<CommissionEarning & {
      employee_code: string;
      employee_name: string;
      invoice_number: string;
      invoice_date: Date;
      invoice_total: number;
    }>(sql, params);

    // Calculate totals
    const totals = commissions.reduce(
      (acc, comm) => {
        if (comm.status === 'pending') acc.pending += comm.commission_amount;
        if (comm.status === 'approved') acc.approved += comm.commission_amount;
        if (comm.status === 'paid') acc.paid += comm.commission_amount;
        acc.total += comm.commission_amount;
        return acc;
      },
      { pending: 0, approved: 0, paid: 0, total: 0 }
    );

    return NextResponse.json({ commissions, totals });
  } catch (error: any) {
    console.error('Error fetching commissions:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/employees/commissions
 * Approve or pay commission
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { commission_id, action, approved_by, payment_reference, notes, updated_by_user_id } = body;

    if (!commission_id || !action) {
      return NextResponse.json(
        { error: 'commission_id and action are required' },
        { status: 400 }
      );
    }

    if (!['approve', 'pay', 'cancel'].includes(action)) {
      return NextResponse.json(
        { error: 'action must be approve, pay, or cancel' },
        { status: 400 }
      );
    }

    if (!updated_by_user_id) {
      return NextResponse.json(
        { error: 'updated_by_user_id is required for authorization' },
        { status: 400 }
      );
    }

    // Get commission with business_id from employee
    const commission = await queryOne<CommissionEarning & { business_id: string }>(
      `SELECT ce.*, e.business_id
       FROM commission_earnings ce
       INNER JOIN employees e ON ce.employee_id = e.id
       WHERE ce.id = $1`,
      [commission_id]
    );

    if (!commission) {
      return NextResponse.json(
        { error: 'Commission not found' },
        { status: 404 }
      );
    }

    // AUTHORIZATION: Check update permission (commissions are part of HR module)
    try {
      await authorize(updated_by_user_id, 'commissions', 'update', { businessId: commission.business_id, resourceId: commission_id });
    } catch (error) {
      if (error instanceof AuthorizationError) {
        return error.toNextResponse();
      }
      throw error;
    }

    if (action === 'approve') {
      if (commission.status !== 'pending') {
        return NextResponse.json(
          { error: 'Only pending commissions can be approved' },
          { status: 400 }
        );
      }

      await query(
        `UPDATE commission_earnings
         SET status = 'approved', approved_by = $1, approved_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
         WHERE id = $2`,
        [approved_by || null, commission_id]
      );
    } else if (action === 'pay') {
      if (commission.status !== 'approved') {
        return NextResponse.json(
          { error: 'Only approved commissions can be paid' },
          { status: 400 }
        );
      }

      await query(
        `UPDATE commission_earnings
         SET status = 'paid', paid_at = CURRENT_TIMESTAMP, payment_reference = $1, notes = $2, updated_at = CURRENT_TIMESTAMP
         WHERE id = $3`,
        [payment_reference || null, notes || null, commission_id]
      );
    } else if (action === 'cancel') {
      if (commission.status === 'paid') {
        return NextResponse.json(
          { error: 'Paid commissions cannot be cancelled' },
          { status: 400 }
        );
      }

      await query(
        `UPDATE commission_earnings
         SET status = 'cancelled', updated_at = CURRENT_TIMESTAMP
         WHERE id = $1`,
        [commission_id]
      );
    }

    const updated = await queryOne<CommissionEarning>(
      'SELECT * FROM commission_earnings WHERE id = $1',
      [commission_id]
    );

    return NextResponse.json({ commission: updated });
  } catch (error: any) {
    console.error('Error updating commission:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}

