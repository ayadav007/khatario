import { NextResponse } from 'next/server';
import { getGstCashLedger } from '@/lib/gst/gst-settlement';
import { isGstJournalContext, openGstJournal } from '@/lib/gst/gst-journal-http';
import { withPremiumSubscriptionApi } from '@/lib/security/premium-module-api';

export const dynamic = 'force-dynamic';

/**
 * GET /api/gst/cash-ledger?as_on_date=YYYY-MM-DD&branch_id=
 * Cash balances, matching output liability, pooled RCM (2155), and the ledger statement.
 * Balances come from get_account_balance. consolidated=1 sums every branch.
 */
export const GET = withPremiumSubscriptionApi({}, async ({ request, businessId, userId }) => {
  try {
    const { searchParams } = new URL(request.url);
    const asOnDate = searchParams.get('as_on_date');
    if (!asOnDate) {
      return NextResponse.json({ error: 'as_on_date is required (YYYY-MM-DD)' }, { status: 400 });
    }
    const consolidated = searchParams.get('consolidated') === '1' || searchParams.get('consolidated') === 'true';
    const ctx = await openGstJournal({
      businessId,
      userId,
      branchIdParam: searchParams.get('branch_id'),
      permission: 'read',
      action: 'read the GST cash ledger',
    });
    if (!isGstJournalContext(ctx)) return ctx;

    const result = await getGstCashLedger({
      businessId,
      asOnDate,
      branchId: consolidated ? null : ctx.branchId,
    });
    return NextResponse.json({
      ...result,
      branch_scope: consolidated ? 'all_branches' : ctx.branchId,
    });
  } catch (error: any) {
    console.error('GST cash ledger error:', error);
    return NextResponse.json({ error: error?.message || 'Failed to load GST cash ledger' }, { status: 500 });
  }
});
