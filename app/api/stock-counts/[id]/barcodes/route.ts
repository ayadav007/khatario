import { NextRequest, NextResponse } from 'next/server';
import { getPool, queryOne } from '@/lib/db';
import { getSessionScopedBusinessId } from '@/lib/auth-helpers';
import { countBarcodes } from '@/lib/items/item-units';
import { authorizeStockCount, stockCountErrorResponse } from '@/lib/stock-counts/route-helpers';

export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * GET /api/stock-counts/[id]/barcodes — what each barcode adds while counting: one unit for an
 * item barcode or code, a whole box for a box barcode. Book quantities are not included.
 */
export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  const businessId = UUID.test(params.id) ? getSessionScopedBusinessId(request) : null;
  const count = businessId
    ? await queryOne<{ warehouse_id: string | null }>(`SELECT warehouse_id FROM stock_counts WHERE id = $1 AND business_id = $2`, [params.id, businessId])
    : null;
  const auth = await authorizeStockCount(request, 'read', { warehouseId: count?.warehouse_id });
  if (!auth.ok) return auth.response;
  if (!count) return NextResponse.json({ error: 'Stock count not found' }, { status: 404 });
  try {
    return NextResponse.json({ barcodes: await countBarcodes(getPool(), auth.businessId, params.id) });
  } catch (error) {
    return stockCountErrorResponse(error, 'Failed to load barcodes');
  }
}
