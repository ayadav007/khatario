import { NextRequest, NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import { listProduction, postProduction } from '@/lib/manufacturing/production';
import { authorizeStockCount, stockCountErrorResponse } from '@/lib/stock-counts/route-helpers';
import { inStockTransaction } from '@/lib/stock-counts/with-transaction';

export const dynamic = 'force-dynamic';

/** GET /api/manufacturing/production — production entries, newest first. */
export async function GET(request: NextRequest) {
  const auth = await authorizeStockCount(request, 'read');
  if (!auth.ok) return auth.response;
  try {
    return NextResponse.json({ entries: await listProduction(getPool(), auth.businessId) });
  } catch (error) {
    return stockCountErrorResponse(error, 'Failed to load production entries');
  }
}

/**
 * POST /api/manufacturing/production — { date, warehouse_id? | branch_id?, bom_id?, batches?,
 *   output_item_id?, output_qty?, lines?: [{ item_id, role, qty, recovery_rate? }], notes? }
 */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const auth = await authorizeStockCount(request, 'adjust_quantity', { warehouseId: body.warehouse_id, adjustmentDate: body.date });
  if (!auth.ok) return auth.response;
  return inStockTransaction(
    async (client) =>
      postProduction(
        client,
        auth.businessId,
        {
          date: String(body.date || ''),
          warehouseId: body.warehouse_id || null,
          branchId: body.branch_id || null,
          bomId: body.bom_id || null,
          batches: body.batches,
          outputItemId: body.output_item_id,
          outputQty: body.output_qty,
          lines: Array.isArray(body.lines) && body.lines.length ? body.lines : undefined,
          notes: body.notes,
        },
        auth.userId
      ),
    'Failed to post production',
    201
  );
}
