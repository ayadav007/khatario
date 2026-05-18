import { NextRequest, NextResponse } from 'next/server';
import { queryOne } from '@/lib/db';

/**
 * GET /api/employees/salary/advances/balance
 * Get pending advance balance for an employee
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const businessId = searchParams.get('business_id');
    const employeeId = searchParams.get('employee_id');

    if (!businessId || !employeeId) {
      return NextResponse.json(
        { error: 'business_id and employee_id are required' },
        { status: 400 }
      );
    }

    // Get all pending/partially recovered advances
    const result = await queryOne<{
      total_advance_amount: number;
      total_recovered_amount: number;
      pending_balance: number;
      advance_count: number;
    }>(`
      SELECT 
        COALESCE(SUM(advance_amount), 0) as total_advance_amount,
        COALESCE(SUM(recovered_amount), 0) as total_recovered_amount,
        COALESCE(SUM(remaining_amount), 0) as pending_balance,
        COUNT(*) as advance_count
      FROM salary_advances
      WHERE business_id = $1
        AND employee_id = $2
        AND status IN ('approved', 'partially_recovered')
    `, [businessId, employeeId]);

    return NextResponse.json({
      total_advance_amount: Number(result?.total_advance_amount || 0),
      total_recovered_amount: Number(result?.total_recovered_amount || 0),
      pending_balance: Number(result?.pending_balance || 0),
      advance_count: Number(result?.advance_count || 0),
    });
  } catch (error: any) {
    console.error('Error fetching advance balance:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}

