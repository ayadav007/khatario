import { NextRequest, NextResponse } from 'next/server';
import { runDueStandingOrders } from '@/lib/supply-standing-orders';
import { assertCronAuthorized } from '@/lib/cron-auth';

export const dynamic = 'force-dynamic';

/**
 * POST /api/cron/standing-orders
 * Creates today's confirmed orders from running Supplier Hub standing orders (once per day).
 */
export async function POST(request: NextRequest) {
  const denied = assertCronAuthorized(request);
  if (denied) return denied;
  try {
    const created = await runDueStandingOrders();
    return NextResponse.json({ success: true, created });
  } catch (error: any) {
    console.error('Error running standing orders:', error);
    return NextResponse.json({ error: error.message || 'Failed to run standing orders' }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  return POST(request);
}
