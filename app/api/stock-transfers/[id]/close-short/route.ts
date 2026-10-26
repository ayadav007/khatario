import { NextRequest, NextResponse } from 'next/server';
import { getPool, queryOne } from '@/lib/db';
import { assertFeatureAccess, FeatureAccessDeniedError } from '@/lib/subscription/feature-access';
import { authorize, AuthorizationError } from '@/lib/authorization';
import { getUserIdFromRequest, requireTenantBusinessId } from '@/lib/auth-helpers';
import { closeTransferShortfall } from '@/lib/stock-custody/transfer-shortfall';
import { stockErrorBody } from '@/lib/inventory/godown-stock';

export const dynamic = 'force-dynamic';

/**
 * POST /api/stock-transfers/[id]/close-short
 * { date, lines: [{ item_id, qty, reason: 'transit_loss' | 'carrier_claim', claim_party?, claim_amount? }], notes? }
 */
export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const body = await request.json().catch(() => ({}));
  const tenant = requireTenantBusinessId(request, body.business_id);
  if (!tenant.ok) return tenant.response;
  const userId = getUserIdFromRequest(request);
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const transfer = await queryOne<{ to_location_id: string; transfer_date: string; status: string }>(
    `SELECT to_location_id, transfer_date::text, status FROM stock_transfers WHERE id = $1 AND business_id = $2`,
    [params.id, tenant.businessId]
  );
  if (!transfer) return NextResponse.json({ error: 'Transfer not found' }, { status: 404 });
  try {
    await assertFeatureAccess(tenant.businessId, 'multi_warehouse');
    // Closing short is part of receiving: the receiving godown confirms what never came.
    await authorize(userId, 'warehouse_transfer', 'receive', {
      businessId: tenant.businessId,
      resourceId: params.id,
      destinationWarehouseId: transfer.to_location_id,
      transfer_date: transfer.transfer_date,
      status: transfer.status,
      resource: transfer,
    } as any);
  } catch (error) {
    if (error instanceof FeatureAccessDeniedError) return error.toNextResponse();
    if (error instanceof AuthorizationError) return error.toNextResponse();
    throw error;
  }

  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const result = await closeTransferShortfall(
      client,
      tenant.businessId,
      params.id,
      { date: String(body.date || ''), lines: Array.isArray(body.lines) ? body.lines : [], notes: body.notes ?? null },
      userId
    );
    await client.query('COMMIT');
    return NextResponse.json({ success: true, ...result });
  } catch (error: any) {
    await client.query('ROLLBACK').catch(() => undefined);
    const refused = stockErrorBody(error);
    if (refused) return NextResponse.json(refused.body, { status: refused.status });
    console.error('Error closing transfer shortfall:', error);
    return NextResponse.json({ error: 'Failed to close the shortfall', details: error?.message }, { status: 500 });
  } finally {
    client.release();
  }
}
