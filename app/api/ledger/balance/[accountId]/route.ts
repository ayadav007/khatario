import { NextResponse } from 'next/server';
import { queryOne } from '@/lib/db';
import { withPremiumSubscriptionApi } from '@/lib/security';

export const dynamic = 'force-dynamic';

/**
 * GET /api/ledger/balance/[accountId]
 * Get account balance as of a specific date (branch-scoped when branch_id is provided).
 */
export const GET = withPremiumSubscriptionApi<{ accountId: string }>(
  {},
  async (ctx) => {
    try {
      const accountId = ctx.params.accountId;
      const { searchParams } = new URL(ctx.request.url);
      const businessId = ctx.businessId;
      const asOnDate = searchParams.get('as_on_date');
      const branchIdParam = searchParams.get('branch_id');

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
  },
);
