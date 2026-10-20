import { NextResponse } from 'next/server';
import { authorize, AuthorizationError } from '@/lib/authorization';
import { listLedgerRegister } from '@/lib/accounting/ledger-register';
import { withPremiumSubscriptionApi } from '@/lib/security';

export const dynamic = 'force-dynamic';

/**
 * GET /api/ledger
 * Day book: every posted line, plus manual rows that exist only in the legacy ledger_entries table.
 */
export const GET = withPremiumSubscriptionApi({}, async (ctx) => {
  try {
    const userId = ctx.userId;

    try {
      await authorize(userId, 'reports', 'read');
    } catch (error) {
      if (error instanceof AuthorizationError) {
        return error.toNextResponse();
      }
      throw error;
    }

    const { searchParams } = new URL(ctx.request.url);
    const businessId = ctx.businessId;
    const accountId = searchParams.get('account_id');
    const fromDate = searchParams.get('from_date');
    const toDate = searchParams.get('to_date');
    const voucherType = searchParams.get('voucher_type');
    const page = parseInt(searchParams.get('page') || '1', 10);
    const limit = parseInt(searchParams.get('limit') || '50', 10);

    let branchIds: string[] | null = null;
    if (userId) {
      const { getUserAccessibleBranchIds } = await import('@/lib/branch-access');
      const accessible = await getUserAccessibleBranchIds(userId);
      // Empty means no branch assignment (same rule as the account ledger): do not hide the books.
      // A restricted user is limited to their branches, and still sees business-level rows such as opening balances.
      branchIds = accessible.length > 0 ? accessible : null;
    }

    const { entries, total } = await listLedgerRegister({
      businessId,
      accountId,
      fromDate,
      toDate,
      voucherType,
      branchIds,
      page,
      limit,
      order: 'desc',
    });

    const safeLimit = Math.min(200, Math.max(1, Number.isFinite(limit) ? limit : 50));
    return NextResponse.json({
      entries,
      pagination: {
        page: Math.max(1, Number.isFinite(page) ? page : 1),
        limit: safeLimit,
        total,
        totalPages: Math.ceil(total / safeLimit),
      },
    });
  } catch (error: any) {
    console.error('Error fetching ledger entries:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
});
