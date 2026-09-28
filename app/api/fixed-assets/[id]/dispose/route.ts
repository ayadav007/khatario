import { NextRequest, NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import { guardLedgerRoute } from '@/lib/http/ledger-route-guard';
import { disposeAsset, FixedAssetError, lockAsset } from '@/lib/accounting/fixed-asset-service';

export const dynamic = 'force-dynamic';

/**
 * POST /api/fixed-assets/[id]/dispose
 * Charges depreciation up to the disposal date (unless charge_depreciation is false), then
 * Dr proceeds + Dr accumulated depreciation / Cr asset cost, with profit (4205) or loss (5218).
 */
export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const body = await request.json().catch(() => ({}));
  const disposalDate = String(body.disposal_date || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(disposalDate)) {
    return NextResponse.json({ error: 'disposal_date (YYYY-MM-DD) is required' }, { status: 400 });
  }
  const proceeds = Number(body.disposal_amount ?? 0);
  if (!Number.isFinite(proceeds) || proceeds < 0) {
    return NextResponse.json({ error: 'disposal_amount must be zero or more' }, { status: 400 });
  }

  const guard = await guardLedgerRoute(request, {
    claimedBusinessId: body.business_id,
    branchId: body.branch_id,
    action: 'create',
    dates: [disposalDate],
    actionLabel: 'dispose of this asset',
  });
  if (!guard.ok) return guard.response;

  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const asset = await lockAsset(client, guard.businessId, params.id);
    const result = await disposeAsset(client, {
      businessId: guard.businessId,
      branchId: guard.branchId,
      userId: guard.userId,
      asset,
      disposalDate,
      proceeds,
      proceedsAccountId: body.proceeds_account_id || null,
      reason: body.reason,
      buyerName: body.buyer_name,
      chargeDepreciation: body.charge_depreciation !== false,
    });
    await client.query('COMMIT');
    return NextResponse.json({ disposal: result, message: 'Asset disposed' }, { status: 201 });
  } catch (error: any) {
    await client.query('ROLLBACK').catch(() => {});
    if (error instanceof FixedAssetError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    }
    console.error('Error disposing asset:', error);
    return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 });
  } finally {
    client.release();
  }
}
