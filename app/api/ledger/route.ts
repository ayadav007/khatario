import { NextResponse } from 'next/server';
import { authorize, AuthorizationError } from '@/lib/authorization';
import { listLedgerRegister, sumLedgerRegisterByAccount } from '@/lib/accounting/ledger-register';
import { presentLedgerEntries } from '@/lib/accounting/ledger-presentation';
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

    const { entries } = await listLedgerRegister({
      businessId,
      accountId,
      fromDate,
      toDate,
      voucherType,
      branchIds,
      limit: null,
      order: 'asc',
    });
    const prior = fromDate
      ? await sumLedgerRegisterByAccount({
          businessId,
          accountId,
          beforeDate: fromDate,
          voucherType,
          branchIds,
        })
      : [];
    const presented = presentLedgerEntries(entries, prior);

    const safePage = Math.max(1, Number.isFinite(page) ? page : 1);
    const safeLimit = Math.min(200, Math.max(1, Number.isFinite(limit) ? limit : 50));
    const offset = (safePage - 1) * safeLimit;
    return NextResponse.json({
      entries: presented.slice(offset, offset + safeLimit),
      pagination: {
        page: safePage,
        limit: safeLimit,
        total: presented.length,
        totalPages: Math.ceil(presented.length / safeLimit),
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
