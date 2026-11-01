import { NextRequest, NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import { othersGoodsHeld, receiveOthersGoods } from '@/lib/stock-custody/inward-custody';
import { authorizeStockCount, stockCountErrorResponse } from '@/lib/stock-counts/route-helpers';
import { inStockTransaction } from '@/lib/stock-counts/with-transaction';

export const dynamic = 'force-dynamic';

/** GET /api/inward-custody?warehouse_id= — other people's goods in our godown. */
export async function GET(request: NextRequest) {
  const warehouseId = request.nextUrl.searchParams.get('warehouse_id');
  const auth = await authorizeStockCount(request, 'read', { warehouseId });
  if (!auth.ok) return auth.response;
  try {
    return NextResponse.json({ goods: await othersGoodsHeld(getPool(), auth.businessId, { warehouseId }) });
  } catch (error) {
    return stockCountErrorResponse(error, "Failed to load others' goods");
  }
}

/**
 * POST /api/inward-custody — { owner_type, owner_id? | owner_name, item_id? | description, unit?, qty,
 *   received_date, reason?, reference?, warehouse_id? | branch_id?, notes? }
 */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const auth = await authorizeStockCount(request, 'read', { warehouseId: body.warehouse_id });
  if (!auth.ok) return auth.response;
  return inStockTransaction(
    async (client) => ({
      id: await receiveOthersGoods(
        client,
        auth.businessId,
        {
          warehouseId: body.warehouse_id || null,
          branchId: body.branch_id || null,
          ownerType: body.owner_type,
          ownerId: body.owner_id || null,
          ownerName: body.owner_name,
          itemId: body.item_id || null,
          description: body.description,
          unit: body.unit,
          qty: Number(body.qty),
          receivedDate: String(body.received_date || ''),
          reason: body.reason,
          reference: body.reference,
          notes: body.notes,
        },
        auth.userId
      ),
    }),
    "Failed to record others' goods",
    201
  );
}
