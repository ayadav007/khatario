import { NextRequest, NextResponse } from 'next/server';
import { sweepDueTodoReminders } from '@/lib/todo-reminders/sweepDueTodoReminders';
import { logTodoReminder } from '@/lib/todo-reminders/reminderLog';
import { getSessionScopedBusinessId, requireTenantBusinessId } from '@/lib/auth-helpers';
import { assertCronAuthorized } from '@/lib/cron-auth';
import { requireNotificationSession } from '@/lib/notifications/notification-session';

export const dynamic = 'force-dynamic';

const MAX_WALL_MS = 25_000;

/**
 * A signed-in user can only sweep their session business (optional ?business_id= must match).
 * The all-business sweep is for system callers without a session, and requires CRON_SECRET
 * (fails closed when it is not configured). Both use the shared DB sweep.
 */
export async function GET(request: NextRequest) {
  const started = Date.now();
  const { searchParams } = new URL(request.url);
  const claimedBusinessId = searchParams.get('business_id');

  if (getSessionScopedBusinessId(request)) {
    const session = await requireNotificationSession(request);
    if (!session.ok) return session.response;
    const tenant = requireTenantBusinessId(request, claimedBusinessId);
    if (!tenant.ok) return tenant.response;
    return runPerBusinessCheckReminders(tenant.businessId, started);
  }

  const denied = assertCronAuthorized(request);
  if (denied) return denied;
  return runGlobalCheckReminders(started);
}

/** Signed-in user: session business only. */
async function runPerBusinessCheckReminders(business_id: string, started: number) {
  try {
    const r = await sweepDueTodoReminders({
      businessId: business_id,
      maxWallMs: MAX_WALL_MS,
      source: 'check_reminders',
    });

    const duration = Date.now() - started;
    logTodoReminder('check_reminders', 'summary', {
      phase: 'complete',
      scope: 'per_business',
      businessId: business_id,
      processed: r.processed,
      skipped: r.skipped,
      failed: r.failed,
      total: r.total,
      batches: r.batches,
      duration,
    });

    return NextResponse.json({
      business_id,
      processed: r.processed,
      skipped: r.skipped,
      failed: r.failed,
      total: r.total,
      duration,
    });
  } catch (error: any) {
    const duration = Date.now() - started;
    logTodoReminder('check_reminders', 'failed', {
      phase: 'critical',
      error: error?.message ?? String(error),
      duration,
    });
    console.error('Check reminders error:', error);
    return NextResponse.json(
      { error: error.message, duration },
      { status: 500 }
    );
  }
}

/** System caller without a session: Authorization: Bearer CRON_SECRET required. */
async function runGlobalCheckReminders(started: number) {
  try {
    const r = await sweepDueTodoReminders({ maxWallMs: MAX_WALL_MS, source: 'check_reminders' });

    const duration = Date.now() - started;
    logTodoReminder('check_reminders', 'summary', {
      phase: 'complete',
      scope: 'global_cron',
      stoppedReason: r.stoppedReason,
      processed: r.processed,
      skipped: r.skipped,
      failed: r.failed,
      total: r.total,
      batches: r.batches,
      duration,
    });

    return NextResponse.json({
      scope: 'global',
      stoppedReason: r.stoppedReason,
      processed: r.processed,
      skipped: r.skipped,
      failed: r.failed,
      total: r.total,
      duration,
    });
  } catch (error: any) {
    const duration = Date.now() - started;
    logTodoReminder('check_reminders', 'failed', {
      phase: 'critical',
      scope: 'global_cron',
      error: error?.message ?? String(error),
      duration,
    });
    console.error('Check reminders (global) error:', error);
    return NextResponse.json(
      { error: error.message, duration },
      { status: 500 }
    );
  }
}
