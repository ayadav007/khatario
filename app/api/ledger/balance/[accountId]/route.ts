import { NextRequest, NextResponse } from 'next/server';
import { queryOne } from '@/lib/db';

/**
 * GET /api/ledger/balance/[accountId]
 * Get account balance as of a specific date (branch-scoped when branch_id is provided).
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { accountId: string } }
) {
  try {
    const accountId = params.accountId;
    const { searchParams } = new URL(request.url);
    const businessId = searchParams.get('business_id');
    const asOnDate = searchParams.get('as_on_date');
    const branchIdParam = searchParams.get('branch_id');

    if (!businessId) {
      return NextResponse.json(
        { error: 'business_id is required' },
        { status: 400 }
      );
    }

    if (!branchIdParam) {
      return NextResponse.json(
        {
          error: 'branch_id is required for branch-scoped ledger balance',
          code: 'BRANCH_REQUIRED',
        },
        { status: 400 }
      );
    }

    const { resolveBranchId } = await import('@/lib/branch-helpers');
    let finalBranchId: string;
    try {
      finalBranchId = await resolveBranchId({
        branchId: branchIdParam,
        businessId: businessId,
      });
    } catch (e: any) {
      return NextResponse.json(
        { error: e?.message || 'Invalid branch' },
        { status: 400 }
      );
    }

    const dateParam = asOnDate || null;
    const result = await queryOne<{ balance: number }>(
      'SELECT get_account_balance($1, $2, $3, $4) as balance',
      [accountId, businessId, dateParam, finalBranchId]
    );

    return NextResponse.json({
      account_id: accountId,
      branch_id: finalBranchId,
      as_on_date: asOnDate || new Date().toISOString().split('T')[0],
      balance: parseFloat(result?.balance?.toString() || '0'),
    });
  } catch (error: any) {
    console.error('Error calculating account balance:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}
