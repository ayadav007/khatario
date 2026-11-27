import { NextRequest, NextResponse } from 'next/server';
import { requirePlatformRequest } from '@/lib/platform-request-auth';
import { cancelUnsentPlatformRefund, PlatformRefundError } from '@/lib/platform-refunds';
import { queryOne } from '@/lib/db';

export const dynamic = 'force-dynamic';

/**
 * POST { refund_id } — abandon a refund that was reserved but never sent to the payment gateway (for example the
 * server stopped between reserving it and sending it). The reserved amount can then be refunded again. A refund the
 * gateway may know about is refused with NOT_REFUNDABLE: repeat the same refund to check where it stands instead.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string; txId: string } },
) {
  const auth = await requirePlatformRequest(request, 'admin', 'can_manage_subscriptions');
  if (!auth.ok) return auth.response;

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const refundId = typeof body?.refund_id === 'string' ? body.refund_id : '';
  if (!/^[0-9a-f-]{36}$/i.test(refundId)) {
    return NextResponse.json({ error: 'Send the refund_id to cancel.', code: 'INVALID_REQUEST' }, { status: 400 });
  }
  // The refund must belong to this payment of this business (the URL), never to whatever the body names.
  const own = await queryOne<{ id: string }>(
    `SELECT id FROM billing_transactions
     WHERE id = $1 AND type = 'refund' AND business_id = $2 AND metadata->>'refund_of' = $3`,
    [refundId, params.id, params.txId],
  );
  if (!own) return NextResponse.json({ error: 'Refund not found.', code: 'NOT_FOUND' }, { status: 404 });
  try {
    await cancelUnsentPlatformRefund(refundId, auth.admin.id);
    return NextResponse.json({ success: true, refund: { id: refundId, status: 'failed', cancelled: true } });
  } catch (error: unknown) {
    if (error instanceof PlatformRefundError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.httpStatus });
    }
    console.error('[admin refund cancel]', error);
    return NextResponse.json({ error: 'The refund could not be cancelled.', code: 'REFUND_FAILED' }, { status: 500 });
  }
}
