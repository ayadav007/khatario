import { queryRows } from '@/lib/db';
import {
  triggerTodoReminder,
  type TodoForReminder,
} from '@/lib/services/todoReminderService';
import { logTodoReminder } from './reminderLog';

/**
 * Due, unsent reminders in (reminder_time, id) order, after an optional keyset position and up
 * to an optional upper bound. Rows `triggerTodoReminder` would always skip are not selected,
 * so they cannot fill batches ahead of deliverable reminders:
 * - no in-app recipient (assignee and creator both empty);
 * - no operational subscription. This must stay a superset of the check in
 *   `triggerTodoReminder` (latest active/trial row, end_date not before today), which remains
 *   the authority: the extra day absorbs app/database time-zone differences. Skipped rows stay
 *   unclaimed and become eligible again when the subscription is renewed.
 */
function dueBatchSql(scoped: boolean): string {
  const p = scoped ? 1 : 0;
  return `SELECT t.*, t.reminder_time::text AS sweep_reminder_time
     FROM todos t
    WHERE t.status IN ('pending', 'in_progress', 'overdue')
      AND t.reminder_sent = false
      AND t.reminder_type IS NOT NULL
      AND t.reminder_type != 'none'
      AND t.reminder_time IS NOT NULL
      AND t.reminder_time <= NOW()
      AND (t.assigned_to IS NOT NULL OR t.created_by IS NOT NULL)
      AND EXISTS (
        SELECT 1
          FROM business_module_subscriptions bms
         WHERE bms.business_id = t.business_id
           AND bms.status IN ('active', 'trial')
           AND (bms.end_date IS NULL OR bms.end_date >= CURRENT_DATE - 1)
      )
      ${scoped ? 'AND t.business_id = $1' : ''}
      AND ($${p + 1}::timestamptz IS NULL OR (t.reminder_time, t.id) > ($${p + 1}::timestamptz, $${p + 2}::uuid))
      AND ($${p + 3}::timestamptz IS NULL OR (t.reminder_time, t.id) <= ($${p + 3}::timestamptz, $${p + 4}::uuid))
    ORDER BY t.reminder_time ASC, t.id ASC
    LIMIT $${p + 5}`;
}

const GLOBAL_SQL = dueBatchSql(false);
const SCOPED_SQL = dueBatchSql(true);

type SweepRow = TodoForReminder & { sweep_reminder_time: string };
type Position = { time: string; id: string };

/**
 * Where a run that hit its time or batch limit stopped, per scope ('global' or a business id).
 * The next run in this process resumes there and wraps around to the start, so rows that keep
 * failing cannot hold back later reminders run after run. In memory only: a restart (or another
 * process) starts from the oldest due row again, which delays but never drops anything.
 */
const resumeAfter = new Map<string, Position>();

export function resetSweepPositionsForTests(): void {
  resumeAfter.clear();
}

export interface SweepResult {
  processed: number;
  skipped: number;
  failed: number;
  total: number;
  batches: number;
  stoppedReason: 'complete' | 'time_limit' | 'batch_limit';
}

export interface SweepOptions {
  /** Only this business (signed-in check-reminders); all businesses otherwise. */
  businessId?: string;
  batchSize?: number;
  maxWallMs?: number;
  maxBatches?: number;
  /** Log source for per-reminder failures. */
  source?: 'worker' | 'cron' | 'check_reminders';
  now?: () => number;
}

/**
 * Delivers every due, unsent reminder straight from the DB. Safe to run alongside BullMQ jobs
 * and other sweeps: `triggerTodoReminder` claims the row atomically, so a reminder is never
 * delivered twice. Each row is visited at most once per run (keyset paging), so skipped or
 * failing rows never stall a run.
 */
export async function sweepDueTodoReminders(options: SweepOptions = {}): Promise<SweepResult> {
  const batchSize = options.batchSize ?? 100;
  const maxWallMs = options.maxWallMs ?? 25_000;
  const maxBatches = options.maxBatches ?? 1000;
  const now = options.now ?? Date.now;
  const scope = options.businessId ?? 'global';
  const started = now();
  const result: SweepResult = {
    processed: 0,
    skipped: 0,
    failed: 0,
    total: 0,
    batches: 0,
    stoppedReason: 'complete',
  };

  // Resume from where the last limited run stopped, then wrap to the start up to that point.
  const resumeFrom = resumeAfter.get(scope) ?? null;
  let after: Position | null = resumeFrom;
  let upTo: Position | null = null;
  let wrapped = resumeFrom === null;

  const stop = (reason: SweepResult['stoppedReason']) => {
    result.stoppedReason = reason;
    if (after) resumeAfter.set(scope, after);
    // Stopped at the wrap point: the next run must start from the oldest rows, not repeat the tail.
    else if (wrapped) resumeAfter.delete(scope);
  };

  while (true) {
    if (now() - started > maxWallMs) {
      stop('time_limit');
      return result;
    }
    if (result.batches >= maxBatches) {
      stop('batch_limit');
      return result;
    }

    const keys = [after?.time ?? null, after?.id ?? null, upTo?.time ?? null, upTo?.id ?? null, batchSize];
    const batch = options.businessId
      ? await queryRows<SweepRow>(SCOPED_SQL, [options.businessId, ...keys])
      : await queryRows<SweepRow>(GLOBAL_SQL, keys);
    if (batch.length > 0) {
      result.batches += 1;
      result.total += batch.length;
    }

    for (const row of batch) {
      if (now() - started > maxWallMs) {
        stop('time_limit');
        return result;
      }
      const { sweep_reminder_time: time, ...todo } = row;
      try {
        const r = await triggerTodoReminder(todo);
        if (r.status === 'delivered') result.processed += 1;
        else result.skipped += 1;
      } catch (err: any) {
        result.failed += 1;
        logTodoReminder(options.source ?? 'worker', 'failed', {
          phase: 'sweep',
          todoId: todo.id,
          businessId: todo.business_id,
          error: err?.message ?? String(err),
        });
      }
      after = { time, id: todo.id };
    }

    if (batch.length < batchSize) {
      if (wrapped) break;
      wrapped = true;
      upTo = resumeFrom;
      after = null;
    }
  }

  resumeAfter.delete(scope);
  return result;
}
