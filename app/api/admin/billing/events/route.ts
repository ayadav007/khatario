import { NextRequest, NextResponse } from 'next/server';
import { requirePlatformRequest } from '@/lib/platform-request-auth';
import { listPlatformBillingEvents, listPlatformBillingTransactions } from '@/lib/platform-billing';

export async function GET(request: NextRequest) {
  const auth = await requirePlatformRequest(request, 'support', 'can_manage_subscriptions');
  if (!auth.ok) return auth.response;

  const { searchParams } = new URL(request.url);
  const limit = Math.min(parseInt(searchParams.get('limit') || '50', 10), 200);
  const offset = parseInt(searchParams.get('offset') || '0', 10);
  const view = searchParams.get('view') || 'events';

  try {
    if (view === 'transactions') {
      const businessId = searchParams.get('business_id') || undefined;
      const transactions = await listPlatformBillingTransactions(limit, offset, businessId);
      return NextResponse.json({ transactions, limit, offset });
    }

    const events = await listPlatformBillingEvents(limit, offset);
    return NextResponse.json({ events, limit, offset });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('platform_billing_webhook_events')) {
      return NextResponse.json({
        events: [],
        warning: 'Run migration 235_platform_billing_phase3.sql',
      });
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
