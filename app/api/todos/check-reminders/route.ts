import { NextRequest, NextResponse } from 'next/server';
import { queryRows } from '@/lib/db';
import { triggerTodoReminder, type TodoForReminder } from '@/lib/services/todoReminderService';
import { logTodoReminder } from '@/lib/todo-reminders/reminderLog';

const BATCH_LIMIT = 100;
const MAX_WALL_MS = 25_000;
const CRON_MAX_BATCHES = 1000;

const DUE_TODOS_PER_BUSINESS = `SELECT *
     FROM todos
     WHERE business_id = $1
       AND status IN ('pending', 'in_progress', 'overdue')
       AND reminder_type IS NOT NULL
       AND reminder_type != 'none'
       AND reminder_time IS NOT NULL
       AND reminder_time <= NOW()
       AND reminder_sent = false
     ORDER BY reminder_time ASC
     LIMIT $2`;

/** All tenants: same shape as /api/cron/send-todo-reminders (Vercel cron has no business_id). */
const DUE_TODOS_GLOBAL = `SELECT t.*
       FROM todos t
       WHERE t.status IN ('pending', 'in_progress', 'overdue')
         AND t.reminder_sent = false
         AND t.reminder_type IS NOT NULL
         AND t.reminder_type != 'none'
         AND t.reminder_time IS NOT NULL
         AND t.reminder_time <= NOW()
       ORDER BY t.reminder_time ASC
       LIMIT $1`;

function assertCronAuthorized(request: NextRequest): NextResponse | null {
  const secret = process.env.CRON_SECRET;
  if (!secret) return null;
  const auth = request.headers.get('authorization');
  if (auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  return null;
}

export async function GET(request: NextRequest) {
  const started = Date.now();
  const { searchParams } = new URL(request.url);
  const business_id = searchParams.get('business_id');

  if (!business_id) {
    const denied = assertCronAuthorized(request);
    if (denied) return denied;
    return runGlobalCheckReminders(started);
  }

  return runPerBusinessCheckReminders(business_id, started);
}

/** Manual / per-tenant: ?business_id= required (no CRON header needed). */
async function runPerBusinessCheckReminders(business_id: string, started: number) {
  try {
    let processed = 0;
    let skipped = 0;
    let failed = 0;
    let total = 0;
    let batchIndex = 0;

    while (true) {
      if (Date.now() - started > MAX_WALL_MS) {
        break;
      }

      const batch = await queryRows<TodoForReminder>(DUE_TODOS_PER_BUSINESS, [
        business_id,
        BATCH_LIMIT,
      ]);

      if (batch.length === 0) {
        break;
      }
      batchIndex += 1;
      total += batch.length;

      for (const todo of batch) {
        try {
          const result = await triggerTodoReminder(todo);
          if (result.status === 'delivered') {
            processed += 1;
          } else {
            skipped += 1;
          }
        } catch (err: any) {
          failed += 1;
          logTodoReminder('check_reminders', 'failed', {
            todoId: todo.id,
            businessId: business_id,
            error: err?.message ?? String(err),
            batch: batchIndex,
          });
        }
      }

      if (batch.length < BATCH_LIMIT) {
        break;
      }
    }

    const duration = Date.now() - started;
    logTodoReminder('check_reminders', 'summary', {
      phase: 'complete',
      scope: 'per_business',
      businessId: business_id,
      processed,
      skipped,
      failed,
      total,
      batches: batchIndex,
      duration,
    });

    return NextResponse.json({
      business_id,
      processed,
      skipped,
      failed,
      total,
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

/** Vercel cron: no business_id; Authorization: Bearer CRON_SECRET when set. */
async function runGlobalCheckReminders(started: number) {
  try {
    let processed = 0;
    let skipped = 0;
    let failed = 0;
    let total = 0;
    let batchIndex = 0;
    let stoppedReason: 'complete' | 'time_limit' | 'batch_limit' = 'complete';

    while (true) {
      if (Date.now() - started > MAX_WALL_MS) {
        stoppedReason = 'time_limit';
        break;
      }
      if (batchIndex >= CRON_MAX_BATCHES) {
        stoppedReason = 'batch_limit';
        break;
      }

      const batch = await queryRows<TodoForReminder>(DUE_TODOS_GLOBAL, [BATCH_LIMIT]);
      if (batch.length === 0) {
        break;
      }
      batchIndex += 1;
      total += batch.length;

      for (const todo of batch) {
        try {
          const result = await triggerTodoReminder(todo);
          if (result.status === 'delivered') {
            processed += 1;
          } else {
            skipped += 1;
          }
        } catch (err: any) {
          failed += 1;
          logTodoReminder('check_reminders', 'failed', {
            todoId: todo.id,
            businessId: todo.business_id,
            error: err?.message ?? String(err),
            batch: batchIndex,
            scope: 'global',
          });
        }
      }

      if (batch.length < BATCH_LIMIT) {
        break;
      }
    }

    const duration = Date.now() - started;
    logTodoReminder('check_reminders', 'summary', {
      phase: 'complete',
      scope: 'global_cron',
      stoppedReason,
      processed,
      skipped,
      failed,
      total,
      batches: batchIndex,
      duration,
    });

    return NextResponse.json({
      scope: 'global',
      stoppedReason,
      processed,
      skipped,
      failed,
      total,
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
