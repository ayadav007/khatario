import { NextRequest, NextResponse } from 'next/server';
import * as db from '@/lib/db';
import { requirePlatformRequest } from '@/lib/platform-request-auth';

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  const auth = await requirePlatformRequest(request, 'support', 'can_manage_subscriptions');
  if (!auth.ok) return auth.response;

  try {
    const transactions = await db.queryRows(
      `SELECT
         id,
         type,
         status,
         amount,
         currency,
         plan_id,
         billing_cycle,
         payment_method,
         payment_reference,
         description,
         invoice_number,
         created_at
       FROM billing_transactions
       WHERE business_id = $1
       ORDER BY created_at DESC
       LIMIT 50`,
      [params.id],
    );

    return NextResponse.json({ transactions });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('billing_transactions')) {
      return NextResponse.json({ transactions: [], warning: 'Billing table not migrated' });
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
