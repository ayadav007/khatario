import { NextRequest, NextResponse } from 'next/server';
import { assertCronAuthorized } from '@/lib/cron-auth';
import { claimDueCarts, purgeStaleCarts, sendCartReminder } from '@/lib/store/abandoned-carts';

export const dynamic = 'force-dynamic';

const BATCH = 50;
const MAX_BATCHES = 10;
const BUDGET_MS = 45_000;

/**
 * GET /api/cron/abandoned-carts
 * Every 15 minutes: one reminder for each open store cart left behind longer than its business's
 * delay, then removes carts untouched for 30 days. A cart is stamped when claimed, so overlapping
 * runs never send twice (docs/SERVER_INFRASTRUCTURE.md).
 */
export async function GET(request: NextRequest) {
  const denied = assertCronAuthorized(request);
  if (denied) return denied;

  const started = Date.now();
  let claimed = 0;
  let sent = 0;
  let failed = 0;
  try {
    for (let i = 0; i < MAX_BATCHES && Date.now() - started < BUDGET_MS; i++) {
      const batch = await claimDueCarts(BATCH);
      if (!batch.length) break;
      claimed += batch.length;
      for (const cart of batch) {
        try {
          const res = await sendCartReminder(cart, 'auto');
          if (res.sent) sent++;
          else failed++;
        } catch (err) {
          failed++;
          console.error('[cron abandoned-carts] send failed for cart', cart.id, err);
        }
      }
      if (batch.length < BATCH) break;
    }
    const purged = await purgeStaleCarts();
    return NextResponse.json({ claimed, sent, failed, purged });
  } catch (error) {
    console.error('[cron abandoned-carts]', error);
    return NextResponse.json({ error: 'Abandoned cart run failed', claimed, sent, failed }, { status: 500 });
  }
}
