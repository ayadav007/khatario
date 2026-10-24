import { NextRequest, NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import { resolveStoreBySubdomain } from '@/lib/store/resolve-store';
import { readStoreCustomer, STORE_CUSTOMER_COOKIE } from '@/lib/store/customer-session';
import { storeReturnEligibility } from '@/lib/returns/store-eligibility';
import {
  createReturn,
  isReturnReason,
  RETURN_REASON_LABELS,
  RETURN_REASONS,
  returnableLines,
  ReturnError,
} from '@/lib/returns/service';

export const dynamic = 'force-dynamic';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type Ctx = { params: { subdomain: string; id: string } };

async function buyer(request: NextRequest, subdomain: string) {
  const store = await resolveStoreBySubdomain(subdomain);
  if (!store) return { error: NextResponse.json({ error: 'Store not found' }, { status: 404 }) };
  const session = readStoreCustomer(request.cookies.get(STORE_CUSTOMER_COOKIE)?.value);
  if (!session || session.businessId !== store.business_id) {
    return { error: NextResponse.json({ error: 'Sign in required' }, { status: 401 }) };
  }
  return { businessId: store.business_id as string, customerId: session.customerId };
}

/** What the buyer can return on this order, and returns already raised for it. */
export async function GET(request: NextRequest, { params }: Ctx) {
  if (!UUID_RE.test(params.id)) return NextResponse.json({ error: 'Order not found' }, { status: 404 });
  const who = await buyer(request, params.subdomain);
  if ('error' in who) return who.error;
  const pool = getPool();
  const existing = await pool.query(
    `SELECT r.return_number, r.status, r.reason, r.requested_at, r.credit_amount::float8 AS credit_amount,
            r.refunded_amount::float8 AS refunded_amount, r.refund_method, r.rejected_reason
       FROM order_returns r
      WHERE r.business_id = $1 AND r.store_order_id = $2
      ORDER BY r.requested_at DESC`,
    [who.businessId, params.id],
  );
  const eligible = await storeReturnEligibility(pool, {
    businessId: who.businessId,
    storeCustomerId: who.customerId,
    orderId: params.id,
  });
  if (!eligible.ok) {
    if (eligible.status === 404) return NextResponse.json({ error: eligible.error }, { status: 404 });
    return NextResponse.json({ can_return: false, reason: eligible.error, returns: existing.rows, lines: [] });
  }
  const lines = (await returnableLines(pool, who.businessId, eligible.invoiceId))
    .filter((l) => l.returnable_qty > 0)
    .map((l) => ({ invoice_item_id: l.invoice_item_id, item_name: l.item_name, unit: l.unit, returnable_qty: l.returnable_qty }));
  return NextResponse.json({
    can_return: lines.length > 0,
    reason: lines.length > 0 ? null : 'Everything on this order has already been returned',
    window_days: eligible.windowDays,
    reasons: RETURN_REASONS.filter((r) => r !== 'not_delivered').map((r) => ({ value: r, label: RETURN_REASON_LABELS[r] })),
    lines,
    returns: existing.rows,
  });
}

/** Buyer asks for a return: { lines: [{ invoice_item_id, quantity }], reason, note? } */
export async function POST(request: NextRequest, { params }: Ctx) {
  if (!UUID_RE.test(params.id)) return NextResponse.json({ error: 'Order not found' }, { status: 404 });
  const who = await buyer(request, params.subdomain);
  if ('error' in who) return who.error;
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const lines = Array.isArray(body.lines)
    ? (body.lines as Record<string, unknown>[])
        .filter((l) => l && typeof l.invoice_item_id === 'string' && UUID_RE.test(l.invoice_item_id))
        .map((l) => ({ invoice_item_id: String(l.invoice_item_id), quantity: Number(l.quantity) }))
        .filter((l) => Number.isFinite(l.quantity) && l.quantity > 0)
    : [];
  if (lines.length === 0) return NextResponse.json({ error: 'Choose the items to return' }, { status: 400 });
  if (!isReturnReason(body.reason) || body.reason === 'not_delivered') {
    return NextResponse.json({ error: 'Choose a reason for the return' }, { status: 400 });
  }

  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const eligible = await storeReturnEligibility(client, {
      businessId: who.businessId,
      storeCustomerId: who.customerId,
      orderId: params.id,
    });
    if (!eligible.ok) {
      await client.query('ROLLBACK');
      return NextResponse.json({ error: eligible.error }, { status: eligible.status });
    }
    const open = await client.query(
      `SELECT 1 FROM order_returns WHERE business_id = $1 AND store_order_id = $2 AND status = 'requested' LIMIT 1`,
      [who.businessId, params.id],
    );
    if (open.rows[0]) {
      await client.query('ROLLBACK');
      return NextResponse.json({ error: 'You already have a return request waiting for this order' }, { status: 409 });
    }
    const id = await createReturn(client, {
      businessId: who.businessId,
      invoiceId: eligible.invoiceId,
      lines,
      reason: body.reason,
      reasonNote: typeof body.note === 'string' ? body.note.slice(0, 1000) : null,
      initiatedBy: 'customer',
      fulfilmentId: eligible.fulfilmentId,
    });
    const num = await client.query<{ return_number: string }>(`SELECT return_number FROM order_returns WHERE id = $1`, [id]);
    await client.query('COMMIT');
    return NextResponse.json({ ok: true, return_number: num.rows[0]?.return_number }, { status: 201 });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    if (error instanceof ReturnError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error('[store return request]', error);
    return NextResponse.json({ error: 'Could not send the return request' }, { status: 500 });
  } finally {
    client.release();
  }
}
