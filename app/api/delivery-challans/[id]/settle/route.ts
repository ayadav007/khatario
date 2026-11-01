import { NextRequest, NextResponse } from 'next/server';
import { getPool, queryOne } from '@/lib/db';
import { requireTenantBusinessId } from '@/lib/auth-helpers';
import { authorizeChallan, challanErrorResponse } from '@/lib/delivery-challans/route-helpers';
import { settleReturnableChallan, type ChallanSettlementInput } from '@/lib/stock-custody/custody';
import { stockErrorBody } from '@/lib/inventory/godown-stock';
import type { ReasonCode } from '@/lib/inventory-adjustment-service';

export const dynamic = 'force-dynamic';

const WRITE_OFF_REASONS: ReasonCode[] = ['CUSTODY_LOSS', 'DAMAGE', 'THEFT', 'TRANSIT_LOSS'];

/**
 * POST /api/delivery-challans/[id]/settle
 * { date, lines: [{ line_id, returned?, invoiced?, written_off? }], write_off_reason?, notes? }
 * Goods back from a returnable challan, sold where they lie, or written off.
 */
export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const client = await getPool().connect();
  try {
    const body = await request.json().catch(() => ({}));
    const tenant = requireTenantBusinessId(request, body.business_id);
    if (!tenant.ok) return tenant.response;
    const auth = await authorizeChallan(request, 'update');
    if (!auth.ok) return auth.response;

    const reason = body.write_off_reason as ReasonCode | undefined;
    if (reason && !WRITE_OFF_REASONS.includes(reason)) {
      return NextResponse.json({ error: 'Invalid write-off reason' }, { status: 400 });
    }
    const input: ChallanSettlementInput = {
      date: String(body.date || ''),
      lines: Array.isArray(body.lines) ? body.lines : [],
      write_off_reason: reason,
      notes: body.notes ?? null,
    };

    await client.query('BEGIN');
    const result = await settleReturnableChallan(client, tenant.businessId, params.id, input, auth.userId);
    await client.query('COMMIT');
    const deliveryChallan = await queryOne('SELECT * FROM delivery_challans WHERE id = $1 AND business_id = $2', [
      params.id,
      tenant.businessId,
    ]);
    return NextResponse.json({ deliveryChallan, ...result });
  } catch (error: any) {
    await client.query('ROLLBACK').catch(() => {});
    const refused = stockErrorBody(error);
    if (refused) return NextResponse.json(refused.body, { status: refused.status });
    return challanErrorResponse(error, 'Failed to record returned goods');
  } finally {
    client.release();
  }
}
