import { NextRequest, NextResponse } from 'next/server';
import { sweepDueTodoReminders } from '@/lib/todo-reminders/sweepDueTodoReminders';
import { logTodoReminder } from '@/lib/todo-reminders/reminderLog';
import { assertCronAuthorized } from '@/lib/cron-auth';

export const dynamic = 'force-dynamic';

/** Vercel / platform safety: do not run unbounded. */
const CRON_MAX_WALL_MS = 25_000;
/** If every batch is full, stop after this many iterations (1e5 rows cap). */
const CRON_MAX_BATCHES = 1000;

export async function GET(request: NextRequest) {
  const denied = assertCronAuthorized(request);
  if (denied) return denied;
  return processTodoReminders();
}

export async function POST(request: NextRequest) {
  const denied = assertCronAuthorized(request);
  if (denied) return denied;
  return processTodoReminders();
}

async function processTodoReminders() {
  try {
    logTodoReminder('cron', 'summary', { phase: 'start' });

    const cronStartedAt = Date.now();
    const r = await sweepDueTodoReminders({
      maxWallMs: CRON_MAX_WALL_MS,
      maxBatches: CRON_MAX_BATCHES,
      source: 'cron',
    });

    logTodoReminder('cron', 'summary', {
      phase: 'complete',
      stoppedReason: r.stoppedReason,
      durationMs: Date.now() - cronStartedAt,
      batches: r.batches,
      totalSeen: r.total,
      processed: r.processed,
      skipped: r.skipped,
      failed: r.failed,
    });

    return NextResponse.json({
      success: true,
      stoppedReason: r.stoppedReason,
      batches: r.batches,
      totalSeen: r.total,
      processed: r.processed,
      skipped: r.skipped,
      failed: r.failed,
    });
  } catch (error: any) {
    logTodoReminder('cron', 'failed', {
      phase: 'critical',
      error: error?.message ?? String(error),
    });
    console.error('[Todo Reminder Cron] Critical error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
