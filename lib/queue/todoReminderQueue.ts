import { Queue } from 'bullmq';
import { reminderPipelineLog } from '@/lib/reminder-pipeline-log';
import { getRedisConnection, waitForRedisReady } from './redis';

/** Single queue instance; cleared on health failure or close error so the next call can retry. */
let todoReminderQueue: Queue | null = null;

/** Avoid spamming when queue stays unavailable (no Redis URL or persistent unready). */
let scheduleNoQueueDetailedLogged = false;
let cancelNoQueueDetailedLogged = false;

function resetQueueIfPresent(): void {
  if (!todoReminderQueue) {
    return;
  }
  const q = todoReminderQueue;
  todoReminderQueue = null;
  void q.close().catch((err) => {
    console.error('[Todo Reminder Queue] Error closing queue during reset:', err);
  });
}

/**
 * Lazy, recoverable: no cached “init failed” state. If Redis is down, returns null; next call retries.
 * If a queue exists but Redis is not ready, the queue is closed and cleared.
 * Logs only when BullMQ Queue construction throws (not on null connection / not-ready, to avoid spam).
 */
function getQueue(): Queue | null {
  if (todoReminderQueue) {
    const conn = getRedisConnection();
    if (!conn || conn.status !== 'ready') {
      resetQueueIfPresent();
      return null;
    }
    return todoReminderQueue;
  }

  const connection = getRedisConnection();
  if (!connection || connection.status !== 'ready') {
    return null;
  }

  try {
    todoReminderQueue = new Queue('todo-reminders', {
      connection: connection as any,
    });
    return todoReminderQueue;
  } catch (error) {
    console.error(
      '[Todo Reminder Queue] Failed to create BullMQ queue (will retry on next call):',
      error
    );
    return null;
  }
}

export async function scheduleTodoReminder(
  todoId: string,
  reminderTime: Date
): Promise<void> {
  reminderPipelineLog('queue.schedule.start', {
    todoId,
    reminderIso: reminderTime.toISOString(),
    redisStatus: getRedisConnection()?.status ?? 'no_client',
  });

  const ready = await waitForRedisReady();
  reminderPipelineLog('queue.schedule.redis_wait', { todoId, ready });
  if (!ready) {
    if (!scheduleNoQueueDetailedLogged) {
      console.error(
        `[Todo Reminder Queue] Redis not ready — reminder not scheduled for todo ${todoId}. Try GET /api/todos/check-reminders?business_id=...`
      );
      scheduleNoQueueDetailedLogged = true;
    }
    return;
  }

  const queue = getQueue();

  if (!queue) {
    reminderPipelineLog('queue.schedule.no_queue', { todoId });
    if (!scheduleNoQueueDetailedLogged) {
      console.error(
        `[Todo Reminder Queue] Queue unavailable: cannot schedule delayed jobs (Redis/BullMQ). Set REDIS_URL, ensure Redis is up, and run "npm run worker:todo". Cron/check-reminders may still deliver when due. Further schedule failures in this process will not repeat this message.`
      );
      scheduleNoQueueDetailedLogged = true;
    }
    return;
  }

  try {
    // BullMQ job IDs cannot contain colons - use dash instead
    const jobId = `todo-${todoId}`;
    const delay = Math.max(0, reminderTime.getTime() - Date.now());

    const existingJob = await queue.getJob(jobId);
    if (existingJob) {
      await existingJob.remove();
      reminderPipelineLog('queue.schedule.removed_previous_job', { jobId });
    }

    await queue.add(
      'process-reminder',
      { todoId },
      {
        jobId,
        delay,
        removeOnComplete: true,
        removeOnFail: false,
      }
    );

    reminderPipelineLog('queue.schedule.enqueued', {
      todoId,
      jobId,
      delayMs: delay,
      reminderIso: reminderTime.toISOString(),
    });
    console.log(
      `[Todo Reminder Queue] Scheduled reminder for todo ${todoId} at ${reminderTime.toISOString()} (delay ${delay}ms)`
    );
  } catch (error) {
    reminderPipelineLog('queue.schedule.error', {
      todoId,
      error: String(error),
    });
    console.error(
      `[Todo Reminder Queue] Queue unavailable or job add failed for todo ${todoId}:`,
      error
    );
  }
}

/** Remove delayed job when todo is completed, reminder disabled, or time changed (before reschedule). */
export async function cancelScheduledTodoReminder(todoId: string): Promise<void> {
  reminderPipelineLog('queue.cancel.start', { todoId });
  await waitForRedisReady(3000).catch(() => false);
  const queue = getQueue();
  if (!queue) {
    if (!cancelNoQueueDetailedLogged) {
      console.error(
        `[Todo Reminder Queue] Queue unavailable: cannot cancel BullMQ jobs (Redis not configured or init failed). If jobs were previously scheduled, they may still run until Redis is restored. Further cancel attempts in this process will not repeat this message.`
      );
      cancelNoQueueDetailedLogged = true;
    }
    return;
  }

  try {
    const jobId = `todo-${todoId}`;
    const existingJob = await queue.getJob(jobId);
    if (existingJob) {
      await existingJob.remove();
      reminderPipelineLog('queue.cancel.removed', { todoId, jobId });
      console.log(`[Todo Reminder Queue] Cancelled scheduled reminder job for todo ${todoId}`);
    } else {
      reminderPipelineLog('queue.cancel.no_job', { todoId });
    }
  } catch (error) {
    console.error(
      `[Todo Reminder Queue] Failed to cancel reminder job for todo ${todoId}:`,
      error
    );
  }
}
