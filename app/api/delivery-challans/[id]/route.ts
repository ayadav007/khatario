import { NextRequest, NextResponse } from 'next/server';
import { getPool, queryOne, queryRows } from '@/lib/db';
import { requireTenantBusinessId } from '@/lib/auth-helpers';
import {
  canTransition,
  ChallanInputError,
  CHALLAN_STATUSES,
  isChallanEditable,
  writeChallan,
} from '@/lib/delivery-challans/challan';
import { authorizeChallan, challanErrorResponse } from '@/lib/delivery-challans/route-helpers';

export const dynamic = 'force-dynamic';

type Params = { params: { id: string } };

/** GET /api/delivery-challans/[id] — challan with its lines, for the edit form. */
export async function GET(request: NextRequest, { params }: Params) {
  try {
    const tenant = requireTenantBusinessId(request, new URL(request.url).searchParams.get('business_id'));
    if (!tenant.ok) return tenant.response;
    const auth = await authorizeChallan(request, 'read');
    if (!auth.ok) return auth.response;

    const deliveryChallan = await queryOne(
      `SELECT dc.*, c.name AS customer_name
         FROM delivery_challans dc
         LEFT JOIN customers c ON c.id = dc.customer_id
        WHERE dc.id = $1 AND dc.business_id = $2`,
      [params.id, tenant.businessId]
    );
    if (!deliveryChallan) {
      return NextResponse.json({ error: 'Delivery challan not found' }, { status: 404 });
    }
    const items = await queryRows(
      `SELECT * FROM delivery_challan_items WHERE delivery_challan_id = $1 ORDER BY sort_order, id`,
      [params.id]
    );
    return NextResponse.json({ deliveryChallan, items });
  } catch (error: any) {
    return challanErrorResponse(error, 'Failed to load delivery challan');
  }
}

/** PUT /api/delivery-challans/[id] — replace an open (draft or sent) challan. */
export async function PUT(request: NextRequest, { params }: Params) {
  const client = await getPool().connect();
  try {
    const body = await request.json();
    const tenant = requireTenantBusinessId(request, body.business_id);
    if (!tenant.ok) return tenant.response;
    const auth = await authorizeChallan(request, 'update');
    if (!auth.ok) return auth.response;

    await client.query('BEGIN');
    const current = await client.query(
      'SELECT status FROM delivery_challans WHERE id = $1 AND business_id = $2 FOR UPDATE',
      [params.id, tenant.businessId]
    );
    if (!current.rows[0]) throw new ChallanInputError('Delivery challan not found', 404);
    if (!isChallanEditable(current.rows[0].status)) {
      throw new ChallanInputError(`A ${current.rows[0].status} challan cannot be edited`, 409);
    }
    const deliveryChallan = await writeChallan(client, tenant.businessId, body, params.id);
    await client.query('COMMIT');
    return NextResponse.json({ deliveryChallan });
  } catch (error: any) {
    await client.query('ROLLBACK').catch(() => {});
    return challanErrorResponse(error, 'Failed to update delivery challan');
  } finally {
    client.release();
  }
}

/** PATCH /api/delivery-challans/[id] — status change: { status: 'sent' | 'delivered' | 'cancelled' }. */
export async function PATCH(request: NextRequest, { params }: Params) {
  try {
    const body = await request.json();
    const tenant = requireTenantBusinessId(request, body.business_id);
    if (!tenant.ok) return tenant.response;
    const auth = await authorizeChallan(request, 'update');
    if (!auth.ok) return auth.response;

    const next = String(body.status || '');
    if (!(CHALLAN_STATUSES as readonly string[]).includes(next)) {
      throw new ChallanInputError('Invalid status');
    }
    const current = await queryOne<{ status: string }>(
      'SELECT status FROM delivery_challans WHERE id = $1 AND business_id = $2',
      [params.id, tenant.businessId]
    );
    if (!current) throw new ChallanInputError('Delivery challan not found', 404);
    if (!canTransition(current.status, next)) {
      throw new ChallanInputError(`Cannot change a ${current.status} challan to ${next}`, 409);
    }

    const deliveryChallan = await queryOne(
      `UPDATE delivery_challans
          SET status = $3,
              delivered_at = CASE WHEN $3 = 'delivered' THEN NOW() ELSE delivered_at END,
              delivery_date = CASE WHEN $3 = 'delivered' THEN COALESCE(delivery_date, CURRENT_DATE) ELSE delivery_date END,
              cancelled_at = CASE WHEN $3 = 'cancelled' THEN NOW() ELSE cancelled_at END
        WHERE id = $1 AND business_id = $2 AND status = $4
        RETURNING *`,
      [params.id, tenant.businessId, next, current.status]
    );
    if (!deliveryChallan) throw new ChallanInputError('The challan changed meanwhile. Reload and try again.', 409);
    return NextResponse.json({ deliveryChallan });
  } catch (error: any) {
    return challanErrorResponse(error, 'Failed to update delivery challan status');
  }
}
