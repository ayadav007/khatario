import { NextRequest, NextResponse } from 'next/server';
import { queryRows } from '@/lib/db';
import { triggerTodoReminder, type TodoForReminder } from '@/lib/todo-reminders/triggerTodoReminder';
import { logTodoReminder } from '@/lib/todo-reminders/reminderLog';

const DUE_BATCH_SQL = `SELECT t.*
       FROM todos t
       WHERE t.status IN ('pending', 'in_progress', 'overdue')
         AND t.reminder_sent = false
         AND t.reminder_type IS NOT NULL
         AND t.reminder_type != 'none'
         AND t.reminder_time IS NOT NULL
         AND t.reminder_time <= NOW()
       ORDER BY t.reminder_time ASC
       LIMIT 100`;

/** Vercel / platform safety: do not run unbounded. */
const CRON_MAX_WALL_MS = 25_000;
/** If every batch is full, stop after this many iterations (1e5 rows cap). */
const CRON_MAX_BATCHES = 1000;

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
    let processed = 0;
    let skipped = 0;
    let failed = 0;
    let batchIndex = 0;
    let totalSeen = 0;
    let stoppedReason: 'complete' | 'time_limit' | 'batch_limit' = 'complete';

    while (true) {
      if (Date.now() - cronStartedAt > CRON_MAX_WALL_MS) {
        stoppedReason = 'time_limit';
        break;
      }
      if (batchIndex >= CRON_MAX_BATCHES) {
        stoppedReason = 'batch_limit';
        break;
      }

      const batch = await queryRows<TodoForReminder>(DUE_BATCH_SQL);
      if (batch.length === 0) {
        break;
      }
      batchIndex += 1;
      totalSeen += batch.length;

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
          logTodoReminder('cron', 'failed', {
            todoId: todo.id,
            businessId: todo.business_id,
            error: err?.message ?? String(err),
            batch: batchIndex,
          });
        }
      }

      if (batch.length < 100) {
        break;
      }
    }

    logTodoReminder('cron', 'summary', {
      phase: 'complete',
      stoppedReason,
      durationMs: Date.now() - cronStartedAt,
      batches: batchIndex,
      totalSeen,
      processed,
      skipped,
      failed,
    });

    return NextResponse.json({
      success: true,
      stoppedReason,
      batches: batchIndex,
      totalSeen,
      processed,
      skipped,
      failed,
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
