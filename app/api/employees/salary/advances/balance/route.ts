import { NextRequest, NextResponse } from 'next/server';
import { queryOne, queryRows } from '@/lib/db';
import {
  suggestAdvanceRecoveries,
  type AdvanceForRecoverySuggestion,
} from '@/lib/hr/salary-payroll-helpers';

export const dynamic = 'force-dynamic';

import { requireTenantBusinessId } from '@/lib/auth-helpers';

/**
 * GET /api/employees/salary/advances/balance
 * Pending advance balance + suggested installment (recovery_months aware).
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const tenant = requireTenantBusinessId(request, searchParams.get('business_id'));
    if (!tenant.ok) return tenant.response;
    const businessId = tenant.businessId;
    const employeeId = searchParams.get('employee_id');
    const capParam = searchParams.get('cap_amount');
    const capAmount = capParam != null ? Number(capParam) : null;

    if (!businessId || !employeeId) {
      return NextResponse.json(
        { error: 'business_id and employee_id are required' },
        { status: 400 }
      );
    }

    const result = await queryOne<{
      total_advance_amount: number;
      total_recovered_amount: number;
      pending_balance: number;
      advance_count: number;
    }>(
      `
      SELECT 
        COALESCE(SUM(advance_amount), 0) as total_advance_amount,
        COALESCE(SUM(recovered_amount), 0) as total_recovered_amount,
        COALESCE(SUM(remaining_amount), 0) as pending_balance,
        COUNT(*) as advance_count
      FROM salary_advances
      WHERE business_id = $1
        AND employee_id = $2
        AND status IN ('approved', 'partially_recovered')
    `,
      [businessId, employeeId]
    );

    const pendingRows = await queryRows<
      AdvanceForRecoverySuggestion & { recovery_months: number | null }
    >(
      `
      SELECT
        sa.id,
        sa.remaining_amount,
        sa.recovery_months,
        COALESCE(
          (SELECT COUNT(*)::int FROM advance_recoveries ar WHERE ar.advance_id = sa.id),
          0
        ) AS recoveries_done
      FROM salary_advances sa
      WHERE sa.business_id = $1
        AND sa.employee_id = $2
        AND sa.status IN ('approved', 'partially_recovered')
        AND sa.remaining_amount > 0
      ORDER BY sa.advance_date ASC
    `,
      [businessId, employeeId]
    );

    const suggestion = suggestAdvanceRecoveries(
      pendingRows,
      capAmount != null && !Number.isNaN(capAmount) ? capAmount : null
    );

    return NextResponse.json({
      total_advance_amount: Number(result?.total_advance_amount || 0),
      total_recovered_amount: Number(result?.total_recovered_amount || 0),
      pending_balance: Number(result?.pending_balance || 0),
      advance_count: Number(result?.advance_count || 0),
      suggested_recovery: suggestion.suggested_total,
      recovery_breakdown: suggestion.breakdown,
    });
  } catch (error: unknown) {
    console.error('Error fetching advance balance:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}
