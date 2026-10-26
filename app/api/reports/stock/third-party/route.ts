import { NextRequest, NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import { currentUnitCosts } from '@/lib/inventory/cogs-posting';
import { custodyBalances, transitBalances } from '@/lib/stock-custody/custody';
import { inwardTransitBalances } from '@/lib/purchases/goods-in-transit';
import { authorizeStockReport } from '@/lib/stock-custody/report-auth';

export const dynamic = 'force-dynamic';

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * GET /api/reports/stock/third-party?warehouse_id=
 * Stock that is ours but not in the godown: with parties on open returnable challans, and on
 * transfers dispatched but not received. Each line carries its document and e-way bill status.
 */
export async function GET(request: NextRequest) {
  const warehouseId = request.nextUrl.searchParams.get('warehouse_id');
  const auth = await authorizeStockReport(request, warehouseId);
  if (!auth.ok) return auth.response;
  try {
    const pool = getPool();
    const [custody, transit, inward] = await Promise.all([
      custodyBalances(pool, auth.businessId, { warehouseId }),
      transitBalances(pool, auth.businessId, { warehouseId }),
      inwardTransitBalances(pool, auth.businessId, { warehouseId }),
    ]);
    const itemIds = [...new Set([...custody, ...transit, ...inward].map((r) => r.item_id))];
    const cost = itemIds.length
      ? await currentUnitCosts(pool, auth.businessId, itemIds, new Date().toISOString().slice(0, 10))
      : new Map<string, number>();
    const withValue = <T extends { item_id: string; qty: number }>(rows: T[]) =>
      rows.map((r) => {
        const unit_cost = round2(cost.get(r.item_id) || 0);
        return { ...r, unit_cost, value: round2(unit_cost * r.qty) };
      });
    const custodyRows = withValue(custody);
    const transitRows = withValue(transit);
    const inwardRows = withValue(inward);
    const sum = (rows: Array<{ qty: number; value: number }>) => ({
      qty: Math.round(rows.reduce((s, r) => s + r.qty, 0) * 1000) / 1000,
      value: round2(rows.reduce((s, r) => s + r.value, 0)),
    });
    return NextResponse.json({
      as_of: new Date().toISOString(),
      with_third_party: custodyRows,
      in_transit: transitRows,
      inward_transit: inwardRows,
      totals: {
        with_third_party: sum(custodyRows),
        in_transit: sum(transitRows),
        inward_transit: sum(inwardRows),
        overdue_returns: custodyRows.filter((r) => r.overdue).length,
        unproven: [...custodyRows, ...transitRows, ...inwardRows].filter((r) => r.eway_bill_status === 'expired').length,
      },
    });
  } catch (error: any) {
    console.error('Error loading stock with third parties:', error);
    return NextResponse.json({ error: 'Failed to load stock with third parties', details: error?.message }, { status: 500 });
  }
}
