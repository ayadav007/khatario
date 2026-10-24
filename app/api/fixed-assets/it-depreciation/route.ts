import { NextRequest, NextResponse } from 'next/server';
import { queryRows } from '@/lib/db';
import { guardLedgerRoute } from '@/lib/http/ledger-route-guard';
import { computeItBlocks, fyLabel, fyStartYear, parseFyLabel } from '@/lib/accounting/it-depreciation';

export const dynamic = 'force-dynamic';

/**
 * GET /api/fixed-assets/it-depreciation?fy=2026-27
 * Income-tax s.32 block-wise WDV computation (not posted to books).
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const guard = await guardLedgerRoute(request, {
    claimedBusinessId: searchParams.get('business_id'),
    action: 'read',
  });
  if (!guard.ok) return guard.response;

  const today = new Date().toISOString().slice(0, 10);
  const fy = searchParams.get('fy') || fyLabel(fyStartYear(today));
  if (parseFyLabel(fy) == null) {
    return NextResponse.json({ error: 'fy must look like 2026-27' }, { status: 400 });
  }

  try {
    const assets = await queryRows<{
      it_block: string | null;
      cost: number;
      put_to_use: string;
      disposal_date: string | null;
      disposal_amount: number | null;
    }>(
      `SELECT it_block,
              purchase_cost::float8 AS cost,
              to_char(COALESCE(put_to_use_date, purchase_date), 'YYYY-MM-DD') AS put_to_use,
              to_char(disposal_date, 'YYYY-MM-DD') AS disposal_date,
              disposal_amount::float8 AS disposal_amount
         FROM fixed_assets
        WHERE business_id = $1`,
      [guard.businessId]
    );

    const rows = computeItBlocks(
      assets
        .filter((a) => a.it_block)
        .map((a) => ({
          block: a.it_block as string,
          cost: Number(a.cost),
          putToUseDate: a.put_to_use,
          disposalDate: a.disposal_date,
          disposalProceeds: a.disposal_amount,
        })),
      fy
    );
    const unclassified = assets.filter((a) => !a.it_block).length;

    return NextResponse.json({ fy, rows, unclassified });
  } catch (error: any) {
    console.error('Error computing IT depreciation:', error);
    return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 });
  }
}
