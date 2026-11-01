import { NextRequest, NextResponse } from 'next/server';
import { getPool, queryOne } from '@/lib/db';
import { getSessionScopedBusinessId } from '@/lib/auth-helpers';
import {
  cancelStockCount,
  postStockCount,
  recordCountEntries,
  setDifferenceReasons,
  stockCountReconciliation,
  submitStockCount,
} from '@/lib/stock-counts/counts';
import { authorizeStockCount, stockCountErrorResponse } from '@/lib/stock-counts/route-helpers';

export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Params = { params: { id: string } };

/** GET /api/stock-counts/[id] — the count with its reconciliation (book figures hidden while blind). */
export async function GET(request: NextRequest, { params }: Params) {
  const businessId = UUID.test(params.id) ? getSessionScopedBusinessId(request) : null;
  const count = businessId
    ? await queryOne<{ warehouse_id: string | null }>(`SELECT warehouse_id FROM stock_counts WHERE id = $1 AND business_id = $2`, [
        params.id,
        businessId,
      ])
    : null;
  const auth = await authorizeStockCount(request, 'read', { warehouseId: count?.warehouse_id });
  if (!auth.ok) return auth.response;
  if (!count) return NextResponse.json({ error: 'Stock count not found' }, { status: 404 });
  try {
    return NextResponse.json(await stockCountReconciliation(getPool(), auth.businessId, params.id));
  } catch (error) {
    return stockCountErrorResponse(error, 'Failed to load stock count');
  }
}

/**
 * PATCH /api/stock-counts/[id]
 *   { action: 'count', entries: [{ item_id, physical_qty, third_party_qty? }] }
 *   { action: 'submit', fill_uncounted?: 'book' | 'zero' }
 *   { action: 'reasons', reasons: [{ item_id, reason_code, reason_notes? }] }
 *   { action: 'post' } | { action: 'cancel' }
 */
export async function PATCH(request: NextRequest, { params }: Params) {
  const body = await request.json().catch(() => ({}));
  const businessId = UUID.test(params.id) ? getSessionScopedBusinessId(request) : null;
  const count = businessId
    ? await queryOne<{ warehouse_id: string | null; count_date: string }>(
        `SELECT warehouse_id, count_date::text FROM stock_counts WHERE id = $1 AND business_id = $2`,
        [params.id, businessId]
      )
    : null;
  const auth = await authorizeStockCount(request, 'adjust_quantity', {
    warehouseId: count?.warehouse_id,
    adjustmentDate: count?.count_date,
    stockCountId: params.id,
  });
  if (!auth.ok) return auth.response;
  if (!count) return NextResponse.json({ error: 'Stock count not found' }, { status: 404 });

  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    let result: Record<string, unknown> = {};
    switch (body.action) {
      case 'count':
        result = await recordCountEntries(client, auth.businessId, params.id, Array.isArray(body.entries) ? body.entries : [], auth.userId);
        break;
      case 'submit':
        await submitStockCount(client, auth.businessId, params.id, {
          fillUncounted: body.fill_uncounted === 'zero' || body.fill_uncounted === 'book' ? body.fill_uncounted : null,
          userId: auth.userId,
        });
        break;
      case 'reasons':
        await setDifferenceReasons(client, auth.businessId, params.id, Array.isArray(body.reasons) ? body.reasons : []);
        break;
      case 'post':
        result = await postStockCount(client, auth.businessId, params.id, auth.userId);
        break;
      case 'cancel':
        await cancelStockCount(client, auth.businessId, params.id);
        break;
      default:
        await client.query('ROLLBACK');
        return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
    }
    await client.query('COMMIT');
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    return stockCountErrorResponse(error, 'Failed to update stock count');
  } finally {
    client.release();
  }
}
