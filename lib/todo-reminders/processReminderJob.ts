import { queryOne } from '@/lib/db';
import { triggerTodoReminder, type TodoForReminder } from '@/lib/services/todoReminderService';
import { reminderPipelineLog } from '@/lib/reminder-pipeline-log';
import { logTodoReminder } from './reminderLog';

export type ReminderJob = { id?: string; data: unknown; attemptsMade?: number };

/**
 * BullMQ `todo-reminders` job handler. The job only carries the todo id; the row is read now and
 * re-checked when claimed, so a job left over from before a snooze or completion delivers
 * nothing. Delivery errors are rethrown so BullMQ marks the job failed (the DB sweep retries).
 */
export async function processTodoReminderJob(job: ReminderJob): Promise<void> {
  const { todoId } = (job.data ?? {}) as { todoId?: string };
  reminderPipelineLog('worker.job_received', { jobId: job.id, todoId });
  if (!todoId) {
    const err = new Error('todo-reminders job missing todoId');
    logTodoReminder('worker', 'failed', {
      jobId: job.id,
      reason: 'missing_todoId',
      error: err.message,
    });
    throw err;
  }

  const todo = await queryOne<TodoForReminder>(`SELECT * FROM todos WHERE id = $1`, [todoId]);

  if (!todo) {
    reminderPipelineLog('worker.todo_missing', { todoId, jobId: job.id });
    logTodoReminder('worker', 'skipped', {
      todoId,
      jobId: job.id,
      reason: 'todo_not_found',
    });
    return;
  }

  reminderPipelineLog('worker.todo_loaded', {
    todoId,
    status: todo.status,
    reminder_sent: (todo as { reminder_sent?: boolean }).reminder_sent,
    business_id: todo.business_id,
  });

  try {
    const result = await triggerTodoReminder(todo);

    reminderPipelineLog('worker.trigger_result', {
      todoId,
      status: result.status,
      reason: result.reason,
      publishedCount: result.published?.length ?? 0,
      published: result.published,
    });

    if (result.status === 'delivered') {
      logTodoReminder('worker', 'processed', {
        todoId,
        jobId: job.id,
        businessId: todo.business_id,
        notificationCount: result.published?.length ?? 0,
      });
      return;
    }

    logTodoReminder('worker', 'skipped', {
      todoId,
      jobId: job.id,
      businessId: todo.business_id,
      reason: result.reason,
      ...(result.status === 'invalid' ? { outcome: 'invalid' } : {}),
    });
  } catch (e: any) {
    logTodoReminder('worker', 'failed', {
      todoId,
      jobId: job.id,
      businessId: todo.business_id,
      error: e?.message ?? String(e),
      attempt: job.attemptsMade,
    });
    throw e;
  }
}
