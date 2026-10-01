import { NextRequest, NextResponse } from 'next/server';
import { getPool, queryOne } from '@/lib/db';
import { authorize, AuthorizationError } from '@/lib/authorization';
import { getAuthenticatedUserId, getSessionScopedBusinessId } from '@/lib/auth-helpers';
import { periodGuardResponse } from '@/lib/http/period-guards';
import { isPaymentUuid } from '@/lib/accounting/final-document-payment';
import {
  PAYMENT_IDEMPOTENCY_HEADER,
  idempotencyKeyReusedError,
  idempotencyReplayUnavailableError,
  readPaymentIdempotencyKey,
} from '@/lib/accounting/payment-idempotency';
import {
  PAYMENT_REVERSE_PERMISSION,
  PaymentReversalError,
  assessPaymentReversal,
  claimReversalIdempotencyKey,
  completeReversalIdempotencyKey,
  currentReversalDate,
  executePaymentReversal,
  findReversalIdempotencyOutcome,
  parseReversalReason,
  reversalRequestFingerprint,
  scopedReversalIdempotencyKey,
  type ReversalIdempotencyOutcome,
} from '@/lib/accounting/payment-reversal';

export const dynamic = 'force-dynamic';

function reversalReplayResponse(outcome: ReversalIdempotencyOutcome): NextResponse {
  if (outcome.kind === 'conflict') {
    return NextResponse.json(idempotencyKeyReusedError(), { status: 409 });
  }
  if (outcome.kind === 'unavailable') {
    return NextResponse.json(idempotencyReplayUnavailableError(), { status: 409 });
  }
  return NextResponse.json(
    { reversal: outcome.reversal, payment: outcome.payment },
    { status: 201, headers: { 'Idempotent-Replayed': 'true' } }
  );
}

/**
 * POST /api/payments/[id]/reverse
 *
 * Reverses a whole posted payment in the current open period. Requires the payments:reverse
 * permission (payment_reversals RBAC module, Create), a non-empty `reason`, and an
 * `X-Idempotency-Key` (or `Idempotency-Key`). Identity comes from the session only.
 * The same key and request returns the original reversal with `Idempotent-Replayed: true`;
 * the same key with a different payment or reason returns 409 IDEMPOTENCY_KEY_REUSED.
 */
export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const actorId = getAuthenticatedUserId(request);
    const businessId = getSessionScopedBusinessId(request);
    if (!actorId || !businessId) {
      return NextResponse.json({ error: 'Authentication required', code: 'UNAUTHENTICATED' }, { status: 401 });
    }

    const keyResult = readPaymentIdempotencyKey(request);
    if (!keyResult.ok) return NextResponse.json(keyResult.body, { status: 400 });
    if (!keyResult.key) {
      return NextResponse.json(
        { error: `${PAYMENT_IDEMPOTENCY_HEADER} is required to reverse a payment`, code: 'IDEMPOTENCY_KEY_REQUIRED' },
        { status: 400 }
      );
    }

    const body = await request.json().catch(() => null);
    const reason = parseReversalReason(body?.reason);
    if (!reason) {
      return NextResponse.json(
        { error: 'A reason is required to reverse a payment', code: 'REVERSAL_REASON_REQUIRED' },
        { status: 400 }
      );
    }

    const paymentId = params.id;
    if (!isPaymentUuid(paymentId)) {
      return NextResponse.json({ error: 'Payment not found', code: 'PAYMENT_NOT_FOUND' }, { status: 404 });
    }

    const scoped = await queryOne<{ branch_id: string | null }>(
      `SELECT branch_id FROM payments WHERE id = $1 AND business_id = $2`,
      [paymentId, businessId]
    );

    try {
      await authorize(actorId, PAYMENT_REVERSE_PERMISSION.module, PAYMENT_REVERSE_PERMISSION.action, {
        businessId,
        branchId: scoped?.branch_id ?? undefined,
      });
    } catch (error) {
      if (error instanceof AuthorizationError) return error.toNextResponse();
      throw error;
    }
    if (!scoped) {
      return NextResponse.json({ error: 'Payment not found', code: 'PAYMENT_NOT_FOUND' }, { status: 404 });
    }

    const scopedKey = scopedReversalIdempotencyKey(keyResult.key);
    const fingerprint = reversalRequestFingerprint(paymentId, reason);
    const replayCtx = { businessId, scopedKey, hash: fingerprint.hash, paymentId };

    // A retry of a committed reversal returns it even after the period has been locked.
    const prior = await findReversalIdempotencyOutcome(getPool(), replayCtx);
    if (prior) return reversalReplayResponse(prior);

    try {
      await assessPaymentReversal(getPool(), businessId, paymentId, { lock: false });
    } catch (error) {
      if (error instanceof PaymentReversalError) {
        return NextResponse.json(error.toBody(), { status: error.status });
      }
      throw error;
    }

    const reversalDate = await currentReversalDate(getPool());
    const lockRes = await periodGuardResponse({
      businessId,
      branchId: scoped.branch_id,
      dates: [reversalDate],
      action: 'reverse a payment',
      checkGstFiled: true,
    });
    if (lockRes) return lockRes;

    const client = await getPool().connect();
    let result: Awaited<ReturnType<typeof executePaymentReversal>>;
    try {
      await client.query('BEGIN');
      const claim = await claimReversalIdempotencyKey(client, {
        ...replayCtx,
        userId: actorId,
        storedPayload: fingerprint.storedPayload,
      });
      if (!claim.claimed) {
        await client.query('ROLLBACK');
        return reversalReplayResponse(claim.outcome);
      }

      const plan = await assessPaymentReversal(client, businessId, paymentId, { lock: true });
      result = await executePaymentReversal(client, plan, { businessId, actorId, reason, reversalDate });
      await completeReversalIdempotencyKey(client, claim.rowId, result.reversal);
      await client.query('COMMIT');
    } catch (txError: any) {
      await client.query('ROLLBACK').catch(() => {});
      if (txError instanceof PaymentReversalError) {
        return NextResponse.json(txError.toBody(), { status: txError.status });
      }
      if (txError?.hint === 'LEDGER_PERIOD_LOCKED' || /locked period/i.test(txError?.message || '')) {
        return NextResponse.json(
          { error: 'Cannot reverse a payment: the current period is locked.', code: 'PERIOD_LOCKED' },
          { status: 403 }
        );
      }
      console.error('Error reversing payment (transaction rolled back):', txError);
      return NextResponse.json(
        { error: 'Failed to reverse payment', code: 'PAYMENT_REVERSAL_FAILED' },
        { status: 500 }
      );
    } finally {
      client.release();
    }

    const { logActivity, getClientIP, getUserAgent } = await import('@/lib/activity-logger');
    await logActivity({
      business_id: businessId,
      user_id: actorId,
      action_type: 'update',
      module: 'payments',
      entity_id: paymentId,
      entity_type: 'payment',
      description: `Reversed payment of ₹${Number(result.reversal.amount).toLocaleString('en-IN')}`,
      ip_address: getClientIP(request),
      user_agent: getUserAgent(request),
      metadata: {
        reversal_id: result.reversal.id,
        reversal_date: result.reversal.reversal_date,
        document_effect: result.reversal.document_effect,
        reason,
      },
    });

    return NextResponse.json({ reversal: result.reversal, payment: result.payment }, { status: 201 });
  } catch (error) {
    console.error('Error reversing payment:', error);
    return NextResponse.json({ error: 'Failed to reverse payment', code: 'PAYMENT_REVERSAL_FAILED' }, { status: 500 });
  }
}
