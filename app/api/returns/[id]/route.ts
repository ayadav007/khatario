import { NextRequest, NextResponse } from 'next/server';
import type { PoolClient } from 'pg';
import { getPool } from '@/lib/db';
import { resolveHubAuth } from '@/lib/fulfilment/hub-scope';
import { authorize, AuthorizationError } from '@/lib/authorization';
import { listCashBankAccounts } from '@/lib/accounting/contra';
import { loadShiprocketCreds } from '@/lib/store/delivery';
import {
  approveReturn,
  cancelReturn,
  defaultReturnInstructions,
  getReturn,
  isRefundMethod,
  lockReturn,
  receiveReturn,
  rejectReturn,
  ReturnError,
  setReturnMethod,
  settleReturn,
  type RefundChoice,
} from '@/lib/returns/service';
import {
  bookReturnPickup,
  cancelAbandonedOrder,
  cancelReturnPickup,
  hasLivePickup,
  pickupDetailsFor,
  savePickupDetails,
  type ReturnPickupResult,
} from '@/lib/returns/pickup';
import { checkPendingReturnRefunds, originalRefundRoom, refundReturnToOriginalPayment } from '@/lib/returns/gateway-refund';
import { notifyReturnCustomer } from '@/lib/returns/notify';
import { parsePickupBody, parseReturnMethod } from '@/lib/returns/request-body';
import { refundableOnCreditNote } from '@/lib/credit-notes/refund';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> | { id: string } };
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Shiprocket counts as connected when its login is saved and readable. */
async function shiprocketConnected(businessId: string): Promise<boolean> {
  try {
    return (await loadShiprocketCreds(businessId)) !== null;
  } catch {
    return false;
  }
}

async function load(businessId: string, id: string, branchIds: string[] | null) {
  const client = await getPool().connect();
  try {
    const row = await getReturn(client, { businessId, returnId: id, branchIds });
    if (!row) return null;
    const refundable = row.credit_note_id
      ? (await refundableOnCreditNote(client, businessId, row.credit_note_id))?.refundable ?? 0
      : 0;
    const accounts = await listCashBankAccounts(client, businessId);
    const pickup = await pickupDetailsFor(client, businessId, id);
    const room = await originalRefundRoom(client, businessId, id);
    return {
      return: {
        ...row,
        // Saved on the return, else what approving would save (the parcel's address, its weight...).
        pickup: pickup && {
          address: pickup.address,
          pincode: pickup.pincode,
          phone: pickup.phone,
          weight_kg: pickup.weightKg,
          length_cm: pickup.lengthCm,
          breadth_cm: pickup.breadthCm,
          height_cm: pickup.heightCm,
        },
        shiprocket_connected: await shiprocketConnected(businessId),
        default_instructions: await defaultReturnInstructions(client, businessId, id),
        original_refund: { allowed: room.allowed, max: room.max, reason: room.reason },
      },
      refundable,
      payment_accounts: accounts,
    };
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
  if (r.method !== 'original_payment' && !isRefundMethod(r.method)) return null;
  const amount = r.amount == null || r.amount === '' ? null : Number(r.amount);
  return {
    method: r.method,
    amount: amount != null && Number.isFinite(amount) ? amount : null,
    paymentAccountId: typeof r.payment_account_id === 'string' && UUID_RE.test(r.payment_account_id) ? r.payment_account_id : null,
    reference: typeof r.reference === 'string' ? r.reference.slice(0, 200) : null,
  };
}

async function inTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const out = await fn(client);
    await client.query('COMMIT');
    return out;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

/** Books after the action committed. A crash here must not turn a saved approval into an error. */
async function bookPickup(
  businessId: string,
  returnId: string,
  userId: string,
  abandonedOrderId?: string | null,
): Promise<ReturnPickupResult> {
  try {
    return await bookReturnPickup(businessId, returnId, { actorUserId: userId, abandonedOrderId: abandonedOrderId ?? null });
  } catch (error) {
    console.error('[returns book pickup]', error);
    return { ok: false, code: 'BOOKING_FAILED', error: 'Could not book the pickup. Try Book again.' };
  }
}

/**
 * PATCH /api/returns/:id
 *   { action: 'approve', method?, instructions?, pickup? }   method defaults to courier_pickup when Shiprocket is connected
 *   { action: 'book_pickup', pickup? } | { action: 'cancel_pickup' }
 *   { action: 'set_method', method, instructions?, pickup? }
 *   { action: 'reject', reason? } | { action: 'cancel' }       a live pickup is cancelled in Shiprocket first
 *   { action: 'receive', lines?: [{ id, received_qty, condition: 'restock'|'damaged' }], date?, refund? }
 *   { action: 'settle', refund: { method: 'original_payment'|'store_credit'|'cash'|'upi'|'bank', amount?, payment_account_id?, reference? } }
 *   { action: 'check_refund' }                                 asks the gateway about a refund on its way
 *   pickup = { address?, pincode?, phone?, weight_kg?, length_cm?, breadth_cm?, height_cm? }
 *
 * Shiprocket and gateway calls run after the action's transaction has committed, never inside it.
 */
export async function PATCH(request: NextRequest, ctx: Ctx) {
  const auth = await resolveHubAuth(request, 'update');
  if (!auth.ok) return auth.response;
  const { id } = await ctx.params;
  if (!UUID_RE.test(id)) return NextResponse.json({ error: 'Return not found' }, { status: 404 });
  const businessId = auth.scope.businessId;
  const userId = auth.userId;
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const action = String(body.action ?? '');
  const instructions = typeof body.instructions === 'string' ? body.instructions : null;
  const date = typeof body.date === 'string' && DATE_RE.test(body.date) ? body.date : null;

  const usesWayBack = action === 'approve' || action === 'set_method' || action === 'book_pickup';
  const methodIn = parseReturnMethod(usesWayBack ? body.method : null);
  if (!methodIn.ok) return NextResponse.json({ error: methodIn.error }, { status: 400 });
  const pickupIn = parsePickupBody(usesWayBack ? body.pickup : null);
  if (!pickupIn.ok) return NextResponse.json({ error: pickupIn.error }, { status: 400 });
  const pickup = pickupIn.value;
  const method =
    action === 'approve'
      ? methodIn.value ?? ((await shiprocketConnected(businessId)) ? 'courier_pickup' : 'customer_sends')
      : methodIn.value;

  // Receiving posts a credit note and settling may pay money out: both need credit-note rights.
  // So does "no need to send it back", which receives the return at once.
  if (action === 'receive' || action === 'settle' || (usesWayBack && method === 'no_return')) {
    try {
      await authorize(userId, 'credit_notes', 'create', { businessId });
    } catch (error) {
      if (error instanceof AuthorizationError) return error.toNextResponse();
      throw error;
    }
  }

  const visible = await getReturn(getPool(), { businessId, returnId: id, branchIds: auth.scope.branchIds });
  if (!visible) return NextResponse.json({ error: 'Return not found' }, { status: 404 });

  const respond = async (extra: Record<string, unknown> = {}) => {
    const out = await load(businessId, id, auth.scope.branchIds);
    return NextResponse.json({ ok: true, ...out, ...extra });
  };

  try {
    if (action === 'approve') {
      const result = await inTransaction((c) =>
        approveReturn(c, { businessId, returnId: id, userId, method, instructions, pickup }),
      );
      const extra: Record<string, unknown> = {};
      if (result.needsPickup) {
        extra.pickup = await bookPickup(businessId, id, userId, result.abandonedOrderId);
      } else if (result.abandonedOrderId) {
        await cancelAbandonedOrder(businessId, result.abandonedOrderId);
      }
      if (result.received) {
        extra.credit_note_number = result.received.creditNoteNumber;
        extra.credit_amount = result.received.creditAmount;
      }
      // After the booking attempt, so a booked pickup's AWB is in the message.
      await notifyReturnCustomer(businessId, id, 'approved');
      return respond(extra);
    }

    if (action === 'book_pickup') {
      const saved = await inTransaction(async (c) => {
        const row = await lockReturn(c, businessId, id);
        if (row.status !== 'approved' || row.return_method !== 'courier_pickup') {
          throw new ReturnError(409, 'NOT_COURIER_PICKUP', 'Approve the return with a courier pickup before booking it');
        }
        if (row.pickup_status === 'in_transit' || row.pickup_status === 'arrived') {
          throw new ReturnError(409, 'PICKED_UP', 'The parcel is already on its way back; receive it instead');
        }
        if (hasLivePickup(row)) throw new ReturnError(409, 'PICKUP_LIVE', 'A courier pickup is already booked for this return');
        return savePickupDetails(c, { businessId, returnId: id, details: pickup });
      });
      const booked = await bookPickup(businessId, id, userId, saved.abandonedOrderId);
      if (booked.ok) await notifyReturnCustomer(businessId, id, 'pickup_booked');
      return respond({ pickup: booked });
    }

    if (action === 'cancel_pickup') {
      const cancelled = await cancelReturnPickup(businessId, id, { actorUserId: userId });
      if (!cancelled.ok) return NextResponse.json({ error: cancelled.error }, { status: cancelled.status });
      return respond();
    }

    if (action === 'set_method') {
      if (!method) return NextResponse.json({ error: 'Choose how the goods come back' }, { status: 400 });
      const result = await inTransaction((c) =>
        setReturnMethod(c, { businessId, returnId: id, userId, method, instructions, pickup }),
      );
      const extra: Record<string, unknown> = {};
      if (result.needsPickup) {
        const booked = await bookPickup(businessId, id, userId, result.abandonedOrderId);
        extra.pickup = booked;
        if (booked.ok) await notifyReturnCustomer(businessId, id, 'pickup_booked');
      } else {
        if (result.abandonedOrderId) await cancelAbandonedOrder(businessId, result.abandonedOrderId);
        if (result.received) {
          extra.credit_note_number = result.received.creditNoteNumber;
          extra.credit_amount = result.received.creditAmount;
        }
        // The customer learns the new way back (where to send it, or that there is nothing to send).
        await notifyReturnCustomer(businessId, id, 'approved');
      }
      return respond(extra);
    }

    if (action === 'reject' || action === 'cancel') {
      // The courier must not come for goods the shop no longer takes back; if Shiprocket refuses, stop here.
      if (hasLivePickup(visible)) {
        const cancelled = await cancelReturnPickup(businessId, id, { actorUserId: userId });
        if (!cancelled.ok) return NextResponse.json({ error: cancelled.error }, { status: cancelled.status });
      }
      if (action === 'reject') {
        const reason = typeof body.reason === 'string' ? body.reason : null;
        await inTransaction((c) => rejectReturn(c, { businessId, returnId: id, reason, userId }));
        await notifyReturnCustomer(businessId, id, 'rejected');
      } else {
        await inTransaction((c) => cancelReturn(c, { businessId, returnId: id, userId }));
      }
      return respond();
    }

    if (action === 'receive') {
      const lines = Array.isArray(body.lines)
        ? (body.lines as Record<string, unknown>[])
            .filter((l) => l && typeof l.id === 'string' && UUID_RE.test(l.id))
            .map((l) => ({
              id: String(l.id),
              received_qty: l.received_qty == null || l.received_qty === '' ? null : Number(l.received_qty),
              condition: l.condition === 'damaged' ? ('damaged' as const) : ('restock' as const),
            }))
        : null;
      const refund = parseRefund(body.refund);
      // A refund to the original payment is a gateway call: it goes after the receive has committed.
      const toGateway = refund?.method === 'original_payment';
      const result = await inTransaction((c) =>
        receiveReturn(c, { businessId, returnId: id, userId, lines, date, refund: toGateway ? null : refund }),
      );
      const extra: Record<string, unknown> = { credit_note_number: result.creditNoteNumber, credit_amount: result.creditAmount };
      await notifyReturnCustomer(businessId, id, 'received');
      if (refund && !toGateway && result.status === 'closed' && result.refundable > 0.004) {
        await notifyReturnCustomer(businessId, id, 'refunded');
      }
      if (refund && toGateway && result.status === 'received') {
        try {
          extra.refund = await refundReturnToOriginalPayment({ businessId, returnId: id, userId, amount: refund.amount });
        } catch (error) {
          // The goods are received either way; the refund can be tried again from the refund step.
          if (!(error instanceof ReturnError)) console.error('[returns receive refund]', error);
          extra.refund_error =
            error instanceof ReturnError
              ? { error: error.message, code: error.code }
              : { error: 'Could not send the refund', code: 'REFUND_FAILED' };
        }
      }
      return respond(extra);
    }

    if (action === 'settle') {
      const refund = parseRefund(body.refund);
      if (!refund) return NextResponse.json({ error: 'Choose how to pay the customer back' }, { status: 400 });
      if (refund.method === 'original_payment') {
        // The customer hears "refunded" from gateway-refund.ts once the gateway has processed it.
        const sent = await refundReturnToOriginalPayment({ businessId, returnId: id, userId, amount: refund.amount });
        return respond({ refund: sent });
      }
      const status = await inTransaction((c) => settleReturn(c, { businessId, returnId: id, userId, date, ...refund }));
      if (status === 'closed') await notifyReturnCustomer(businessId, id, 'refunded');
      return respond();
    }

    if (action === 'check_refund') {
      const check = await checkPendingReturnRefunds({ olderThanMinutes: 0, businessId, returnId: id });
      return respond({ check });
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  } catch (error) {
    if (error instanceof ReturnError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    }
    console.error('[returns update]', error);
    return NextResponse.json({ error: 'Could not update the return' }, { status: 500 });
  }
}
