import { NextRequest, NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import { resolveHubAuth } from '@/lib/fulfilment/hub-scope';
import {
  createReturn,
  isReturnReason,
  listReturns,
  returnableLines,
  ReturnError,
  type ReturnStatus,
} from '@/lib/returns/service';

export const dynamic = 'force-dynamic';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STATUSES = ['open', 'requested', 'approved', 'rejected', 'received', 'closed', 'cancelled'];

/**
 * GET /api/returns?status=open|requested|...&invoice_id=  list returns (session business only)
 * GET /api/returns?returnable_for=<invoice_id>             bill lines that can still be returned
 */
export async function GET(request: NextRequest) {
  const auth = await resolveHubAuth(request, 'read');
  if (!auth.ok) return auth.response;
  const { searchParams } = new URL(request.url);

  const returnableFor = searchParams.get('returnable_for');
  if (returnableFor) {
    if (!UUID_RE.test(returnableFor)) return NextResponse.json({ error: 'Bill not found' }, { status: 404 });
    const lines = await returnableLines(getPool(), auth.scope.businessId, returnableFor);
    return NextResponse.json({ lines });
  }

  const status = searchParams.get('status');
  const invoiceId = searchParams.get('invoice_id');
  const returns = await listReturns(getPool(), {
    businessId: auth.scope.businessId,
    branchIds: auth.scope.branchIds,
    status: status && STATUSES.includes(status) ? (status as ReturnStatus | 'open') : null,
    invoiceId: invoiceId && UUID_RE.test(invoiceId) ? invoiceId : null,
    limit: Number(searchParams.get('limit')) || 100,
  });
  const counts = await getPool().query<{ status: string; n: number }>(
    `SELECT status, COUNT(*)::int AS n FROM order_returns
      WHERE business_id = $1 AND status IN ('requested', 'approved', 'received')
        AND ($2::uuid[] IS NULL OR branch_id IS NULL OR branch_id = ANY($2::uuid[]))
      GROUP BY status`,
    [auth.scope.businessId, auth.scope.branchIds],
  );
  return NextResponse.json({
    returns,
    counts: Object.fromEntries(counts.rows.map((r) => [r.status, r.n])),
  });
}

/** POST /api/returns  { invoice_id, lines?: [{ invoice_item_id, quantity }], reason, reason_note? } */
export async function POST(request: NextRequest) {
  const auth = await resolveHubAuth(request, 'update');
  if (!auth.ok) return auth.response;
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const invoiceId = typeof body.invoice_id === 'string' ? body.invoice_id : '';
  if (!UUID_RE.test(invoiceId)) return NextResponse.json({ error: 'Choose the bill to return against' }, { status: 400 });
  const lines = Array.isArray(body.lines)
    ? (body.lines as Record<string, unknown>[])
        .filter((l) => l && typeof l.invoice_item_id === 'string' && UUID_RE.test(l.invoice_item_id))
        .map((l) => ({ invoice_item_id: String(l.invoice_item_id), quantity: Number(l.quantity) }))
    : null;

  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const id = await createReturn(client, {
      businessId: auth.scope.businessId,
      invoiceId,
      lines,
      reason: isReturnReason(body.reason) ? body.reason : 'other',
      reasonNote: typeof body.reason_note === 'string' ? body.reason_note : null,
      initiatedBy: 'merchant',
      userId: auth.userId,
    });
    await client.query('COMMIT');
    return NextResponse.json({ id }, { status: 201 });
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
}
