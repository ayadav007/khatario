import { NextRequest, NextResponse } from 'next/server';
import { requirePlatformRequest } from '@/lib/platform-request-auth';
import { recordBillingTransaction } from '@/lib/platform-billing';
import { queryOne } from '@/lib/db';

/**
 * POST /api/admin/businesses/[id]/billing/record
 * Manually record a subscription payment outcome (support).
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  const auth = await requirePlatformRequest(request, 'admin', 'can_manage_subscriptions');
  if (!auth.ok) return auth.response;

  try {
    const business = await queryOne(`SELECT id FROM businesses WHERE id = $1`, [params.id]);
    if (!business) {
      return NextResponse.json({ error: 'Business not found' }, { status: 404 });
    }

    const body = await request.json();
    const status = body.status === 'failed' ? 'failed' : body.status === 'pending' ? 'pending' : 'completed';
    const planId = body.plan_id;
    if (!planId) {
      return NextResponse.json({ error: 'plan_id is required' }, { status: 400 });
    }

    const result = await recordBillingTransaction({
      businessId: params.id,
      planId,
      amount: Number(body.amount) || 0,
      billingCycle: body.billing_cycle === 'yearly' ? 'yearly' : 'monthly',
      paymentMethod: body.payment_method || 'manual',
      paymentReference: body.payment_reference,
      status,
      description: body.description || `Manual record by admin`,
    });

    return NextResponse.json({ success: true, transaction: result });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
