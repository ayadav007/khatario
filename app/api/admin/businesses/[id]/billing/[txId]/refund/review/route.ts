import { NextRequest, NextResponse } from 'next/server';
import { requirePlatformRequest } from '@/lib/platform-request-auth';
import { markRefundReviewed } from '@/lib/platform-refund-review';

export const dynamic = 'force-dynamic';

/**
 * POST { refund_id } — a platform admin records that they looked at a refund Khatario flagged for review.
 * The reviewer (from the session) and the time are written into the refund row's metadata, and the
 * reconcile report stops listing the refund. Nothing about the money or the customer's plan changes.
 * The refund must belong to this payment of this business (the URL), never to whatever the body names.
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
    return NextResponse.json({ error: 'Send the refund_id to mark as reviewed.', code: 'INVALID_REQUEST' }, { status: 400 });
  }
  try {
    const result = await markRefundReviewed({
      refundId,
      paymentId: params.txId,
      businessId: params.id,
      adminId: auth.admin.id,
    });
    if (result === 'not_found') {
      return NextResponse.json({ error: 'Refund not found.', code: 'NOT_FOUND' }, { status: 404 });
    }
    return NextResponse.json({ success: true, already_reviewed: result === 'already_reviewed' });
  } catch (error) {
    console.error('[admin refund review]', error);
    return NextResponse.json({ error: 'The refund could not be marked as reviewed.', code: 'REVIEW_FAILED' }, { status: 500 });
  }
}
