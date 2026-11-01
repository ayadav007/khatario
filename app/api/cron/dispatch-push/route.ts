import { NextRequest, NextResponse } from 'next/server';
import { assertCronAuthorized } from '@/lib/cron-auth';
import { dispatchPushJobs } from '@/lib/push/dispatcher';
import { fcmUnavailableReason } from '@/lib/push/fcm';

export const dynamic = 'force-dynamic';

/** Keeps one call well inside a platform request timeout. */
const MAX_WALL_MS = 25_000;
const ROUND_LIMIT = 50;

/**
 * GET/POST /api/cron/dispatch-push
 * Fallback for the push outbox when the todo-reminder worker (which runs the same dispatcher
 * continuously) is down. Claims are SKIP LOCKED, so running both at once is safe. Schedule every
 * minute; a run with nothing due returns immediately.
 */
async function run() {
  const started = Date.now();
  const totals = { rounds: 0, claimed: 0, sent: 0, retried: 0, failed: 0, skipped: 0, accepted: 0, invalidTokens: 0 };
  try {
    while (Date.now() - started < MAX_WALL_MS) {
      const r = await dispatchPushJobs({ limit: ROUND_LIMIT });
      totals.rounds += 1;
      totals.claimed += r.claimed;
      totals.sent += r.sent;
      totals.retried += r.retried;
      totals.failed += r.failed;
      totals.skipped += r.skipped;
      totals.accepted += r.accepted;
      totals.invalidTokens += r.invalidTokens;
      if (r.claimed < ROUND_LIMIT) break;
    }
    return NextResponse.json({ success: true, fcm: fcmUnavailableReason() ?? 'ok', durationMs: Date.now() - started, ...totals });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[cron dispatch-push] failed:', message);
    return NextResponse.json({ error: message, ...totals }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  const denied = assertCronAuthorized(request);
  if (denied) return denied;
  return run();
}

export async function POST(request: NextRequest) {
  const denied = assertCronAuthorized(request);
  if (denied) return denied;
  return run();
}
