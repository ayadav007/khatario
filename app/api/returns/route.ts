import { NextRequest, NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import { resolveHubAuth } from '@/lib/fulfilment/hub-scope';
import { authorize, AuthorizationError } from '@/lib/authorization';
import {
  createReturn,
  isReturnReason,
  listReturns,
  returnableLines,
  returnNeedsPickup,
  ReturnError,
  type ReturnStatus,
} from '@/lib/returns/service';
import { bookReturnPickup, type ReturnPickupResult } from '@/lib/returns/pickup';
import { notifyReturnCustomer } from '@/lib/returns/notify';
import { loadShiprocketCreds } from '@/lib/store/delivery';
import { parsePickupBody, parseReturnMethod } from '@/lib/returns/request-body';

export const dynamic = 'force-dynamic';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STATUSES = ['open', 'requested', 'approved', 'rejected', 'received', 'closed', 'cancelled', 'refund_pending'];

/**
 * GET /api/returns?status=open|requested|...|refund_pending&invoice_id=  list returns (session business only);
 *   refund_pending = a refund to the original payment is on its way
 * GET /api/returns?returnable_for=<invoice_id>             bill lines that can still be returned, and whether Shiprocket is connected
 */
export async function GET(request: NextRequest) {
  const auth = await resolveHubAuth(request, 'read');
  if (!auth.ok) return auth.response;
  const { searchParams } = new URL(request.url);

  const returnableFor = searchParams.get('returnable_for');
  if (returnableFor) {
    if (!UUID_RE.test(returnableFor)) return NextResponse.json({ error: 'Bill not found' }, { status: 404 });
    const lines = await returnableLines(getPool(), auth.scope.businessId, returnableFor);
    // Lets the start-a-return form hide "Courier pickup" when Shiprocket is not connected.
    const shiprocketConnected = await loadShiprocketCreds(auth.scope.businessId).then(
      (creds) => creds !== null,
      () => false,
    );
    return NextResponse.json({ lines, shiprocket_connected: shiprocketConnected });
  }

  const status = searchParams.get('status');
  const invoiceId = searchParams.get('invoice_id');
  const returns = await listReturns(getPool(), {
    businessId: auth.scope.businessId,
    branchIds: auth.scope.branchIds,
    status: status && STATUSES.includes(status) ? (status as ReturnStatus | 'open' | 'refund_pending') : null,
    invoiceId: invoiceId && UUID_RE.test(invoiceId) ? invoiceId : null,
    limit: Number(searchParams.get('limit')) || 100,
  });
  const counts = await getPool().query<{ status: string; n: number }>(
    `SELECT status, COUNT(*)::int AS n FROM order_returns
      WHERE business_id = $1 AND status IN ('requested', 'approved', 'received')
        AND ($2::uuid[] IS NULL OR branch_id IS NULL OR branch_id = ANY($2::uuid[]))
      GROUP BY status
     UNION ALL
     SELECT 'refund_pending', COUNT(DISTINCT r.id)::int FROM order_returns r
       JOIN return_gateway_refunds g ON g.order_return_id = r.id AND g.business_id = r.business_id AND g.status = 'pending'
      WHERE r.business_id = $1
        AND ($2::uuid[] IS NULL OR r.branch_id IS NULL OR r.branch_id = ANY($2::uuid[]))`,
    [auth.scope.businessId, auth.scope.branchIds],
  );
  return NextResponse.json({
    returns,
    counts: Object.fromEntries(counts.rows.map((r) => [r.status, r.n])),
  });
}

/**
 * POST /api/returns  { invoice_id, lines?: [{ invoice_item_id, quantity }], reason, reason_note?, method?, instructions?, pickup? }
 * The shop's own returns start approved; with a courier pickup it is booked once the return is saved.
 */
export async function POST(request: NextRequest) {
  const auth = await resolveHubAuth(request, 'update');
  if (!auth.ok) return auth.response;
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const invoiceId = typeof body.invoice_id === 'string' ? body.invoice_id : '';
  if (!UUID_RE.test(invoiceId)) return NextResponse.json({ error: 'Choose the bill to return against' }, { status: 400 });
  const method = parseReturnMethod(body.method);
  if (!method.ok) return NextResponse.json({ error: method.error }, { status: 400 });
  const pickup = parsePickupBody(body.pickup);
  if (!pickup.ok) return NextResponse.json({ error: pickup.error }, { status: 400 });
  if (method.value === 'no_return') {
    // Receives the return at once, posting a credit note.
    try {
      await authorize(auth.userId, 'credit_notes', 'create', { businessId: auth.scope.businessId });
    } catch (error) {
      if (error instanceof AuthorizationError) return error.toNextResponse();
      throw error;
    }
  }
  const lines = Array.isArray(body.lines)
    ? (body.lines as Record<string, unknown>[])
        .filter((l) => l && typeof l.invoice_item_id === 'string' && UUID_RE.test(l.invoice_item_id))
        .map((l) => ({ invoice_item_id: String(l.invoice_item_id), quantity: Number(l.quantity) }))
    : null;

  let created: string;
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    created = await createReturn(client, {
      businessId: auth.scope.businessId,
      invoiceId,
      lines,
      reason: isReturnReason(body.reason) ? body.reason : 'other',
      reasonNote: typeof body.reason_note === 'string' ? body.reason_note : null,
      initiatedBy: 'merchant',
      userId: auth.userId,
      method: method.value,
      instructions: typeof body.instructions === 'string' ? body.instructions : null,
      pickup: pickup.value,
    });
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    if (error instanceof ReturnError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    }
    console.error('[returns create]', error);
    return NextResponse.json({ error: 'Could not create the return' }, { status: 500 });
  } finally {
    client.release();
  }

  // Shiprocket is called only after the return is saved, as approving does.
  const businessId = auth.scope.businessId;
  let booked: ReturnPickupResult | undefined;
  if (await returnNeedsPickup(getPool(), { businessId, returnId: created })) {
    try {
      booked = await bookReturnPickup(businessId, created, { actorUserId: auth.userId });
    } catch (error) {
      console.error('[returns create book pickup]', error);
      booked = { ok: false, code: 'BOOKING_FAILED', error: 'Could not book the pickup. Try Book again.' };
    }
  }
  if (method.value) await notifyReturnCustomer(businessId, created, 'approved');
  return NextResponse.json({ id: created, ...(booked ? { pickup: booked } : {}) }, { status: 201 });
}
