import { NextRequest, NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import { guardLedgerRoute } from '@/lib/http/ledger-route-guard';
import {
  FixedAssetError,
  lockAsset,
  nextDepreciationStart,
  postAssetDepreciation,
} from '@/lib/accounting/fixed-asset-service';

export const dynamic = 'force-dynamic';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * POST /api/fixed-assets/[id]/depreciate
 * Posts Schedule II depreciation from the next uncovered date (or period_start_date)
 * to period_end_date, pro rata by days. The period must stay within one financial year.
 */
export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const body = await request.json().catch(() => ({}));
  const periodEnd = String(body.period_end_date || '').slice(0, 10);
  if (!ISO_DATE.test(periodEnd)) {
    return NextResponse.json({ error: 'period_end_date (YYYY-MM-DD) is required' }, { status: 400 });
  }
  const requestedStart = body.period_start_date ? String(body.period_start_date).slice(0, 10) : null;
  if (requestedStart && !ISO_DATE.test(requestedStart)) {
    return NextResponse.json({ error: 'period_start_date must be YYYY-MM-DD' }, { status: 400 });
  }

  const guard = await guardLedgerRoute(request, {
    claimedBusinessId: body.business_id,
    branchId: body.branch_id,
    action: 'create',
    dates: [periodEnd],
    actionLabel: 'post depreciation',
  });
  if (!guard.ok) return guard.response;

  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const asset = await lockAsset(client, guard.businessId, params.id);
    const periodStart = requestedStart || nextDepreciationStart(asset);
    const result = await postAssetDepreciation(client, {
      businessId: guard.businessId,
      branchId: guard.branchId,
      asset,
      periodStart,
      periodEnd,
    });
    await client.query('COMMIT');
    return NextResponse.json(
      {
        depreciation: { ...result, period_start_date: periodStart, period_end_date: periodEnd },
        book_value: asset.current_book_value,
        message: result.amount > 0 ? 'Depreciation posted' : 'No depreciation due for this period',
      },
      { status: 201 }
    );
  } catch (error: any) {
    await client.query('ROLLBACK').catch(() => {});
    if (error instanceof FixedAssetError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    }
    console.error('Error posting depreciation:', error);
    return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 });
  } finally {
    client.release();
  }
}
