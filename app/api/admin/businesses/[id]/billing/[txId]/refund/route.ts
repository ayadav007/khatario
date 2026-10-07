import { NextRequest, NextResponse } from 'next/server';
import { requirePlatformRequest } from '@/lib/platform-request-auth';
import { updateBillingTransactionStatus } from '@/lib/platform-billing';
import { queryOne } from '@/lib/db';

export const dynamic = 'force-dynamic';

/**
 * POST — mark a completed platform billing transaction as refunded.
 * Also cancels any linked partner commission (pending/approved/paid).
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string; txId: string } },
) {
  const auth = await requirePlatformRequest(request, 'admin', 'can_manage_subscriptions');
  if (!auth.ok) return auth.response;

  const tx = await queryOne<{ id: string; status: string; business_id: string }>(
    `SELECT id, status, business_id FROM billing_transactions
     WHERE id = $1 AND business_id = $2`,
    [params.txId, params.id],
  );
  if (!tx) return NextResponse.json({ error: 'Transaction not found' }, { status: 404 });
  if (tx.status === 'refunded') {
    return NextResponse.json({ success: true, already: true });
  }
  if (tx.status !== 'completed') {
    return NextResponse.json(
      { error: `Only completed transactions can be refunded (current: ${tx.status})` },
      { status: 409 },
    );
  }

  try {
    const body = await request.json().catch(() => ({}));
    await updateBillingTransactionStatus(params.txId, 'refunded', {
      refunded_by_admin: auth.admin.id,
      notes: typeof body.notes === 'string' ? body.notes : null,
    });
    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
