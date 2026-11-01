import { NextRequest, NextResponse } from 'next/server';
import { assertCronAuthorized } from '@/lib/cron-auth';
import { checkPendingReturnRefunds } from '@/lib/returns/gateway-refund';

export const dynamic = 'force-dynamic';

/**
 * GET/POST /api/cron/return-refunds — every 30 minutes, asks the gateway about return refunds still
 * pending after 10 minutes and posts the ones it has processed (once; the Razorpay notice usually
 * confirms first). A Razorpay attempt that never got an answer is sent again with the same key.
 */
export async function POST(request: NextRequest) {
  const denied = assertCronAuthorized(request);
  if (denied) return denied;
  const result = await checkPendingReturnRefunds();
  return NextResponse.json(result);
}

export async function GET(request: NextRequest) {
  return POST(request);
}
