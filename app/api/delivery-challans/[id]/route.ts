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
import { dispatchReturnableChallan } from '@/lib/stock-custody/custody';
import { stockErrorBody } from '@/lib/inventory/godown-stock';
import { listEwayBills } from '@/lib/gst/eway-bill-records';

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
      `SELECT dc.*, c.name AS customer_name, s.name AS supplier_name, w.name AS warehouse_name
         FROM delivery_challans dc
         LEFT JOIN customers c ON c.id = dc.customer_id
         LEFT JOIN suppliers s ON s.id = dc.supplier_id
         LEFT JOIN warehouses w ON w.id = dc.warehouse_id
        WHERE dc.id = $1 AND dc.business_id = $2`,
      [params.id, tenant.businessId]
    );
    if (!deliveryChallan) {
      return NextResponse.json({ error: 'Delivery challan not found' }, { status: 404 });
    }
    const items = await queryRows(
      `SELECT *, (qty - qty_returned - qty_invoiced - qty_written_off) AS qty_open
         FROM delivery_challan_items WHERE delivery_challan_id = $1 ORDER BY sort_order, id`,
      [params.id]
    );
    const ewayBills = await listEwayBills(getPool(), tenant.businessId, {
      sourceType: 'delivery_challan',
      sourceId: params.id,
    }).catch(() => []);
    return NextResponse.json({ deliveryChallan, items, ewayBills });
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
      'SELECT status, stock_posted_at FROM delivery_challans WHERE id = $1 AND business_id = $2 FOR UPDATE',
      [params.id, tenant.businessId]
    );
    if (!current.rows[0]) throw new ChallanInputError('Delivery challan not found', 404);
    if (!isChallanEditable(current.rows[0].status)) {
      throw new ChallanInputError(`A ${current.rows[0].status} challan cannot be edited`, 409);
    }
    if (current.rows[0].stock_posted_at) {
      throw new ChallanInputError('The goods on this challan have been sent out. Record returns instead of editing it.', 409);
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
    const current = await queryOne<{ status: string; challan_kind: string; stock_posted_at: string | null; closed_at: string | null }>(
      'SELECT status, challan_kind, stock_posted_at, closed_at FROM delivery_challans WHERE id = $1 AND business_id = $2',
      [params.id, tenant.businessId]
    );
    if (!current) throw new ChallanInputError('Delivery challan not found', 404);
    if (!canTransition(current.status, next)) {
      throw new ChallanInputError(`Cannot change a ${current.status} challan to ${next}`, 409);
    }
    if (current.challan_kind === 'returnable') {
      if (next === 'delivered') {
        throw new ChallanInputError('Record the goods coming back to close a returnable challan.', 409);
      }
      if (next === 'cancelled' && current.stock_posted_at && !current.closed_at) {
        throw new ChallanInputError('These goods are still out. Record their return before cancelling.', 409);
      }
      if (next === 'sent') {
        // Sending a returnable challan moves its goods out of the godown.
        const client = await getPool().connect();
        try {
          await client.query('BEGIN');
          await dispatchReturnableChallan(client, tenant.businessId, params.id, auth.userId);
          await client.query('COMMIT');
        } catch (error) {
          await client.query('ROLLBACK').catch(() => {});
          throw error;
        } finally {
          client.release();
        }
        const sent = await queryOne('SELECT * FROM delivery_challans WHERE id = $1 AND business_id = $2', [
          params.id,
          tenant.businessId,
        ]);
        return NextResponse.json({ deliveryChallan: sent });
      }
    }

    const deliveryChallan = await queryOne(
      `UPDATE delivery_challans
          SET status = $3::varchar,
              delivered_at = CASE WHEN $3::varchar = 'delivered' THEN NOW() ELSE delivered_at END,
              delivery_date = CASE WHEN $3::varchar = 'delivered' THEN COALESCE(delivery_date, CURRENT_DATE) ELSE delivery_date END,
              cancelled_at = CASE WHEN $3::varchar = 'cancelled' THEN NOW() ELSE cancelled_at END
        WHERE id = $1 AND business_id = $2 AND status = $4
        RETURNING *`,
      [params.id, tenant.businessId, next, current.status]
    );
    if (!deliveryChallan) throw new ChallanInputError('The challan changed meanwhile. Reload and try again.', 409);
    return NextResponse.json({ deliveryChallan });
  } catch (error: any) {
    const refused = stockErrorBody(error);
    if (refused) return NextResponse.json(refused.body, { status: refused.status });
    return challanErrorResponse(error, 'Failed to update delivery challan status');
  }
}
