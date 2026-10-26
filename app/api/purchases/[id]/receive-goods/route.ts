import { NextRequest, NextResponse } from 'next/server';
import { getPool, queryOne } from '@/lib/db';
import { authorize, AuthorizationError } from '@/lib/authorization';
import { getAuthenticatedUserId, getSessionScopedBusinessId } from '@/lib/auth-helpers';
import { holdPurchaseInTransit, receivePurchaseGoods, setTransitStage } from '@/lib/purchases/goods-in-transit';
import { stockErrorBody } from '@/lib/inventory/godown-stock';

export const dynamic = 'force-dynamic';

/**
 * POST /api/purchases/[id]/receive-goods
 *   { action: 'receive', date, lines: [{ purchase_item_id, qty }] } — goods of an in-transit bill arrive
 *   { action: 'hold' } — mark a final bill's goods as not yet arrived
 *   { action: 'stage', stage, bill_of_entry_number?, bill_of_entry_date? } — where the goods are now
 */
export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const userId = getAuthenticatedUserId(request);
  const businessId = getSessionScopedBusinessId(request);
  if (!userId || !businessId) {
    return NextResponse.json({ error: 'Authentication required', code: 'UNAUTHENTICATED' }, { status: 401 });
  }
  const purchase = await queryOne<{ branch_id: string | null }>(
    `SELECT branch_id FROM purchases WHERE id = $1 AND business_id = $2 AND deleted_at IS NULL`,
    [params.id, businessId]
  );
  if (!purchase) return NextResponse.json({ error: 'Purchase not found' }, { status: 404 });
  try {
    await authorize(userId, 'purchases', 'update', { businessId, branchId: purchase.branch_id || undefined, resourceId: params.id });
  } catch (error) {
    if (error instanceof AuthorizationError) return error.toNextResponse();
    throw error;
  }

  const body = await request.json().catch(() => ({}));
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    let result: Record<string, unknown>;
    if (body.action === 'stage') {
      await setTransitStage(client, businessId, params.id, {
        stage: body.stage,
        bill_of_entry_number: body.bill_of_entry_number ?? null,
        bill_of_entry_date: body.bill_of_entry_date ?? null,
      });
      result = { stage: body.stage };
    } else if (body.action === 'hold') {
      result = { lines: await holdPurchaseInTransit(client, businessId, params.id, userId), goods_status: 'in_transit' };
    } else {
      result = await receivePurchaseGoods(
        client,
        businessId,
        params.id,
        { date: String(body.date || ''), lines: Array.isArray(body.lines) ? body.lines : [] },
        userId
      );
    }
    await client.query('COMMIT');
    return NextResponse.json({ success: true, ...result });
  } catch (error: any) {
    await client.query('ROLLBACK').catch(() => undefined);
    const refused = stockErrorBody(error);
    if (refused) return NextResponse.json(refused.body, { status: refused.status });
    console.error('Error receiving purchase goods:', error);
    return NextResponse.json({ error: 'Failed to record the goods', details: error?.message }, { status: 500 });
  } finally {
    client.release();
  }
}
