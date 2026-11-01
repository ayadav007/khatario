import { NextRequest, NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import { heldBalances, holdStock } from '@/lib/stock-custody/holds';
import { authorizeStockCount, stockCountErrorResponse } from '@/lib/stock-counts/route-helpers';
import { inStockTransaction } from '@/lib/stock-counts/with-transaction';

export const dynamic = 'force-dynamic';

/** GET /api/stock-holds?warehouse_id= — stock held in the godown and not saleable. */
export async function GET(request: NextRequest) {
  const warehouseId = request.nextUrl.searchParams.get('warehouse_id');
  const auth = await authorizeStockCount(request, 'read', { warehouseId });
  if (!auth.ok) return auth.response;
  try {
    return NextResponse.json({ holds: await heldBalances(getPool(), auth.businessId, { warehouseId }) });
  } catch (error) {
    return stockCountErrorResponse(error, 'Failed to load held stock');
  }
}

/** POST /api/stock-holds — { item_id, qty, purpose, date, warehouse_id? | branch_id?, reference?, notes? } */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const auth = await authorizeStockCount(request, 'adjust_quantity', { warehouseId: body.warehouse_id, adjustmentDate: body.date });
  if (!auth.ok) return auth.response;
  return inStockTransaction(
    async (client) => ({
      id: await holdStock(
        client,
        auth.businessId,
        {
          warehouseId: body.warehouse_id || null,
          branchId: body.branch_id || null,
          itemId: body.item_id,
          qty: Number(body.qty),
          purpose: body.purpose,
          date: String(body.date || ''),
          reference: body.reference,
          notes: body.notes,
        },
        auth.userId
      ),
    }),
    'Failed to hold stock',
    201
  );
}
