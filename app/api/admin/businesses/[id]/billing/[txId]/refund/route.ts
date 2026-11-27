import { NextRequest, NextResponse } from 'next/server';
import { requirePlatformRequest } from '@/lib/platform-request-auth';
import { PlatformRefundError, refundPlatformPayment } from '@/lib/platform-refunds';

export const dynamic = 'force-dynamic';

/**
 * POST — refund (all or part of) a completed platform subscription payment.
 *
 * Body: { end_plan: 'now' | 'period_end', amount?: number (rupees), notes?: string, idempotency_key?: string }
 * The money goes back through the payment gateway the customer paid with; only then is the plan changed
 * (end_plan 'now' moves the product to its free plan, 'period_end' lets it run to the end of the paid
 * period). Partner commission on a fully refunded payment is cancelled.
 * Returns { success, refund } or { error, code } with code REFUND_EXCEEDS_PAYMENT, NOT_REFUNDABLE,
 * GATEWAY_REFUSED, INVALID_REQUEST or NOT_FOUND. The business comes from the payment row and the
 * admin from the session, never from the body.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string; txId: string } },
) {
  const auth = await requirePlatformRequest(request, 'admin', 'can_manage_subscriptions');
  if (!auth.ok) return auth.response;

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Send a JSON body.', code: 'INVALID_REQUEST' }, { status: 400 });
  }
  const endPlan = body.end_plan;
  if (endPlan !== 'now' && endPlan !== 'period_end') {
    return NextResponse.json(
      { error: "Choose whether the plan ends now ('now') or at the end of the paid period ('period_end').", code: 'INVALID_REQUEST' },
      { status: 400 },
    );
  }
  let amount: number | undefined;
  if (body.amount !== undefined && body.amount !== null && body.amount !== '') {
    amount = typeof body.amount === 'number' ? body.amount : Number.NaN;
    if (!Number.isFinite(amount) || amount <= 0) {
      return NextResponse.json({ error: 'The refund amount must be a number of rupees above zero.', code: 'INVALID_REQUEST' }, { status: 400 });
    }
  }
  const headerKey = request.headers.get('idempotency-key');
  const bodyKey = typeof body.idempotency_key === 'string' ? body.idempotency_key : null;

  try {
    const result = await refundPlatformPayment({
      businessId: params.id,
      transactionId: params.txId,
      adminId: auth.admin.id,
      amount,
      endPlan,
      notes: typeof body.notes === 'string' ? body.notes.slice(0, 1000) : undefined,
      idempotencyKey: headerKey || bodyKey || undefined,
    });
    return NextResponse.json({
      success: true,
      refund: {
        id: result.refundTransactionId,
        status: result.status,
        refunded_total: result.refundedTotal,
        fully_refunded: result.fullyRefunded,
        message: result.message ?? null,
      },
    });
  } catch (error: unknown) {
    if (error instanceof PlatformRefundError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.httpStatus });
    }
    console.error('[admin refund]', error);
    return NextResponse.json(
      { error: 'The refund could not be completed. If money may have left the gateway, repeat the same refund to check; it will not be sent twice.', code: 'REFUND_FAILED' },
      { status: 500 },
    );
  }
}
