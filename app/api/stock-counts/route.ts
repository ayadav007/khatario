import { NextRequest, NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import { listStockCounts, openStockCount } from '@/lib/stock-counts/counts';
import { authorizeStockCount, stockCountErrorResponse } from '@/lib/stock-counts/route-helpers';

export const dynamic = 'force-dynamic';

/** GET /api/stock-counts — counts of this business, newest first. */
export async function GET(request: NextRequest) {
  const auth = await authorizeStockCount(request, 'read');
  if (!auth.ok) return auth.response;
  try {
    return NextResponse.json({ counts: await listStockCounts(getPool(), auth.businessId) });
  } catch (error) {
    return stockCountErrorResponse(error, 'Failed to load stock counts');
  }
}

/**
 * POST /api/stock-counts — open a count of one godown.
 * { warehouse_id? | branch_id?, count_date, blind?, freeze_stock?, recount_tolerance_pct?,
 *   recount_tolerance_value?, write_off_approval_value?, notes? }
 */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const auth = await authorizeStockCount(request, 'adjust_quantity', {
    warehouseId: body.warehouse_id,
    adjustmentDate: body.count_date,
  });
  if (!auth.ok) return auth.response;
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const id = await openStockCount(client, auth.businessId, {
      warehouseId: body.warehouse_id || null,
      branchId: body.branch_id || null,
      countDate: String(body.count_date || ''),
      blind: body.blind,
      freezeStock: body.freeze_stock,
      recountTolerancePct: body.recount_tolerance_pct,
      recountToleranceValue: body.recount_tolerance_value,
      writeOffApprovalValue: body.write_off_approval_value,
      notes: body.notes,
      userId: auth.userId,
    });
    await client.query('COMMIT');
    return NextResponse.json({ id }, { status: 201 });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    return stockCountErrorResponse(error, 'Failed to open stock count');
  } finally {
    client.release();
  }
}
