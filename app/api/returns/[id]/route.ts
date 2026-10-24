import { NextRequest, NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import { resolveHubAuth } from '@/lib/fulfilment/hub-scope';
import { authorize, AuthorizationError } from '@/lib/authorization';
import { listCashBankAccounts } from '@/lib/accounting/contra';
import {
  approveReturn,
  cancelReturn,
  getReturn,
  isRefundMethod,
  receiveReturn,
  rejectReturn,
  ReturnError,
  settleReturn,
  type RefundChoice,
} from '@/lib/returns/service';
import { refundableOnCreditNote } from '@/lib/credit-notes/refund';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> | { id: string } };
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

async function load(businessId: string, id: string, branchIds: string[] | null) {
  const client = await getPool().connect();
  try {
    const row = await getReturn(client, { businessId, returnId: id, branchIds });
    if (!row) return null;
    const refundable = row.credit_note_id
      ? (await refundableOnCreditNote(client, businessId, row.credit_note_id))?.refundable ?? 0
      : 0;
    const accounts = await listCashBankAccounts(client, businessId);
    return { return: row, refundable, payment_accounts: accounts };
  } finally {
    client.release();
  }
}

export async function GET(request: NextRequest, ctx: Ctx) {
  const auth = await resolveHubAuth(request, 'read');
  if (!auth.ok) return auth.response;
  const { id } = await ctx.params;
  if (!UUID_RE.test(id)) return NextResponse.json({ error: 'Return not found' }, { status: 404 });
  const out = await load(auth.scope.businessId, id, auth.scope.branchIds);
  if (!out) return NextResponse.json({ error: 'Return not found' }, { status: 404 });
  return NextResponse.json(out);
}

function parseRefund(raw: unknown): RefundChoice | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (!isRefundMethod(r.method)) return null;
  const amount = r.amount == null || r.amount === '' ? null : Number(r.amount);
  return {
    method: r.method,
    amount: amount != null && Number.isFinite(amount) ? amount : null,
    paymentAccountId: typeof r.payment_account_id === 'string' && UUID_RE.test(r.payment_account_id) ? r.payment_account_id : null,
    reference: typeof r.reference === 'string' ? r.reference.slice(0, 200) : null,
  };
}

/**
 * PATCH /api/returns/:id
 *   { action: 'approve' | 'reject' | 'cancel' }
 *   { action: 'receive', lines?: [{ id, received_qty, condition: 'restock'|'damaged' }], date?, refund? }
 *   { action: 'settle', refund: { method: 'store_credit'|'cash'|'upi'|'bank', amount?, payment_account_id?, reference? } }
 */
export async function PATCH(request: NextRequest, ctx: Ctx) {
  const auth = await resolveHubAuth(request, 'update');
  if (!auth.ok) return auth.response;
  const { id } = await ctx.params;
  if (!UUID_RE.test(id)) return NextResponse.json({ error: 'Return not found' }, { status: 404 });
  const businessId = auth.scope.businessId;
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const action = String(body.action ?? '');

  // Receiving posts a credit note and settling may pay money out: both need credit-note rights.
  if (action === 'receive' || action === 'settle') {
    try {
      await authorize(auth.userId, 'credit_notes', 'create', { businessId });
    } catch (error) {
      if (error instanceof AuthorizationError) return error.toNextResponse();
      throw error;
    }
  }

  const visible = await getReturn(getPool(), { businessId, returnId: id, branchIds: auth.scope.branchIds });
  if (!visible) return NextResponse.json({ error: 'Return not found' }, { status: 404 });

  const client = await getPool().connect();
  let extra: Record<string, unknown> = {};
  try {
    await client.query('BEGIN');
    if (action === 'approve') {
      await approveReturn(client, { businessId, returnId: id });
    } else if (action === 'reject') {
      await rejectReturn(client, { businessId, returnId: id, reason: typeof body.reason === 'string' ? body.reason : null });
    } else if (action === 'cancel') {
      await cancelReturn(client, { businessId, returnId: id });
    } else if (action === 'receive') {
      const lines = Array.isArray(body.lines)
        ? (body.lines as Record<string, unknown>[])
            .filter((l) => l && typeof l.id === 'string' && UUID_RE.test(l.id))
            .map((l) => ({
              id: String(l.id),
              received_qty: l.received_qty == null || l.received_qty === '' ? null : Number(l.received_qty),
              condition: l.condition === 'damaged' ? ('damaged' as const) : ('restock' as const),
            }))
        : null;
      const result = await receiveReturn(client, {
        businessId,
        returnId: id,
        userId: auth.userId,
        lines,
        date: typeof body.date === 'string' && DATE_RE.test(body.date) ? body.date : null,
        refund: parseRefund(body.refund),
      });
      extra = { credit_note_number: result.creditNoteNumber, credit_amount: result.creditAmount };
    } else if (action === 'settle') {
      const refund = parseRefund(body.refund);
      if (!refund) {
        await client.query('ROLLBACK');
        return NextResponse.json({ error: 'Choose how to pay the customer back' }, { status: 400 });
      }
      await settleReturn(client, {
        businessId,
        returnId: id,
        userId: auth.userId,
        date: typeof body.date === 'string' && DATE_RE.test(body.date) ? body.date : null,
        ...refund,
      });
    } else {
      await client.query('ROLLBACK');
      return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    if (error instanceof ReturnError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    }
    console.error('[returns update]', error);
    return NextResponse.json({ error: 'Could not update the return' }, { status: 500 });
  } finally {
    client.release();
  }

  const out = await load(businessId, id, auth.scope.branchIds);
  return NextResponse.json({ ...out, ...extra });
}
