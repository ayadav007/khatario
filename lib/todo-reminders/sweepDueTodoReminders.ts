import { queryRows } from '@/lib/db';
import {
  triggerTodoReminder,
  type TodoForReminder,
} from '@/lib/services/todoReminderService';
import { logTodoReminder } from './reminderLog';

const DUE_BATCH_SQL = `SELECT t.*
     FROM todos t
     WHERE t.status IN ('pending', 'in_progress', 'overdue')
       AND t.reminder_sent = false
       AND t.reminder_type IS NOT NULL
       AND t.reminder_type != 'none'
       AND t.reminder_time IS NOT NULL
       AND t.reminder_time <= NOW()
     ORDER BY t.reminder_time ASC
     LIMIT $1`;

export interface SweepResult {
  processed: number;
  skipped: number;
  failed: number;
  total: number;
  stoppedReason: 'complete' | 'time_limit';
}

/**
 * Delivers every due, unsent reminder straight from the DB. Safe to run alongside BullMQ jobs:
 * `triggerTodoReminder` claims the row atomically, so a reminder is never delivered twice.
 */
export async function sweepDueTodoReminders(
  options: { batchSize?: number; maxWallMs?: number } = {}
): Promise<SweepResult> {
  const batchSize = options.batchSize ?? 100;
  const maxWallMs = options.maxWallMs ?? 25_000;
  const started = Date.now();
  const result: SweepResult = { processed: 0, skipped: 0, failed: 0, total: 0, stoppedReason: 'complete' };

  while (true) {
    if (Date.now() - started > maxWallMs) {
      result.stoppedReason = 'time_limit';
      break;
    }

    const batch = await queryRows<TodoForReminder>(DUE_BATCH_SQL, [batchSize]);
    if (batch.length === 0) break;
    result.total += batch.length;
    let deliveredThisBatch = 0;

    for (const todo of batch) {
      try {
        const r = await triggerTodoReminder(todo);
        if (r.status === 'delivered') {
          result.processed += 1;
          deliveredThisBatch += 1;
        } else {
          result.skipped += 1;
        }
      } catch (err: any) {
        result.failed += 1;
        logTodoReminder('worker', 'failed', {
          phase: 'sweep',
          todoId: todo.id,
          businessId: todo.business_id,
          error: err?.message ?? String(err),
        });
      }
    }

    // Skipped rows (e.g. expired subscription) stay unclaimed and would be re-selected forever.
    if (batch.length < batchSize || deliveredThisBatch === 0) break;
  }

  return result;
}
