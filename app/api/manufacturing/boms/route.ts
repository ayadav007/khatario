import { NextRequest, NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import { listBoms, saveBom } from '@/lib/manufacturing/production';
import { authorizeStockCount, stockCountErrorResponse } from '@/lib/stock-counts/route-helpers';
import { inStockTransaction } from '@/lib/stock-counts/with-transaction';

export const dynamic = 'force-dynamic';

/** GET /api/manufacturing/boms — bills of materials. */
export async function GET(request: NextRequest) {
  const auth = await authorizeStockCount(request, 'read');
  if (!auth.ok) return auth.response;
  try {
    return NextResponse.json({ boms: await listBoms(getPool(), auth.businessId) });
  } catch (error) {
    return stockCountErrorResponse(error, 'Failed to load bills of materials');
  }
}

/** POST /api/manufacturing/boms — { id?, name, output_item_id, output_qty, lines: [{ item_id, role, qty, recovery_rate? }], notes?, is_active? } */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const auth = await authorizeStockCount(request, 'read');
  if (!auth.ok) return auth.response;
  return inStockTransaction(async (client) => ({ id: await saveBom(client, auth.businessId, body, auth.userId) }), 'Failed to save the bill of materials', body.id ? 200 : 201);
}
