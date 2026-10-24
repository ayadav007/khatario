// Load environment variables
import dotenv from 'dotenv';
import path from 'path';

// dotenv never overrides, so earlier files win. The VPS keeps its settings in .env.production.
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });
dotenv.config({ path: path.resolve(process.cwd(), '.env.production') });
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

import { Worker } from 'bullmq';
import { getRedisConnection } from '../queue/redis';
import { reminderPipelineLog } from '@/lib/reminder-pipeline-log';
import { logTodoReminder } from '../todo-reminders/reminderLog';
import { sweepDueTodoReminders } from '../todo-reminders/sweepDueTodoReminders';
import { processTodoReminderJob } from '../todo-reminders/processReminderJob';

/**
 * Delayed BullMQ jobs are lost if Redis is flushed, restarts, or was down when the todo was
 * saved. The DB sweep delivers anything due that the queue missed, so it runs even without Redis.
 */
const SWEEP_INTERVAL_MS = 30_000;

function startDueReminderSweep(): void {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const r = await sweepDueTodoReminders();
      if (r.total > 0) {
        logTodoReminder('worker', 'summary', { phase: 'sweep', ...r });
      }
    } catch (err: any) {
      logTodoReminder('worker', 'failed', { phase: 'sweep', error: err?.message ?? String(err) });
    } finally {
      running = false;
    }
  };
  void tick();
  setInterval(tick, SWEEP_INTERVAL_MS);
}

// Initialize worker
async function startWorker() {
  console.log('========================================');
  console.log('[Todo Reminder Worker] Starting BullMQ Worker...');
  console.log('========================================');

  startDueReminderSweep();
  console.log(`[Todo Reminder Worker] DB sweep running every ${SWEEP_INTERVAL_MS / 1000}s`);

  const redisConnection = getRedisConnection();

  if (!redisConnection) {
    console.error('[Todo Reminder Worker] REDIS_URL not set — running DB sweep only (no exact-time jobs, no live popups).');
    return;
  }

  // Connect to Redis if not already connected (since lazyConnect is true, we need to connect manually)
  console.log('[Todo Reminder Worker] Checking Redis connection...');
  
  // Wait for Redis to be ready with a timeout
  const waitForRedis = async (): Promise<void> => {
    return new Promise((resolve, reject) => {
      // If already ready, resolve immediately
      if (redisConnection.status === 'ready') {
        console.log('[Todo Reminder Worker] Redis already connected');
        resolve();
        return;
      }
      
      // Set up timeout
      const timeout = setTimeout(() => {
        reject(new Error('Redis connection timeout - Memurai may not be running'));
      }, 5000);
      
      // Listen for ready event
      const onReady = () => {
        clearTimeout(timeout);
        redisConnection.removeListener('error', onError);
        console.log('[Todo Reminder Worker] Redis connected successfully');
        resolve();
      };
      
      // Listen for error event
      const onError = (err: Error) => {
        clearTimeout(timeout);
        redisConnection.removeListener('ready', onReady);
        reject(err);
      };
      
      redisConnection.once('ready', onReady);
      redisConnection.once('error', onError);
      
      // If not connecting, start connection
      if (redisConnection.status !== 'connecting') {
        console.log('[Todo Reminder Worker] Connecting to Redis...');
        redisConnection.connect().catch(() => {
          // Error will be handled by onError listener
        });
      } else {
        console.log('[Todo Reminder Worker] Redis is connecting, waiting...');
      }
    });
  };
  
  try {
    await waitForRedis();
    console.log('[Todo Reminder Worker] Redis ready, starting worker...');
  } catch (err: any) {
    console.error('[Todo Reminder Worker] Failed to connect to Redis:', err.message);
    console.error('[Todo Reminder Worker] Running DB sweep only until the next restart.');
    return;
  }

  // The shared client never retries (retryStrategy: null). Exit so PM2 restarts us with a fresh connection.
  redisConnection.on('end', () => {
    console.error('[Todo Reminder Worker] Redis connection ended — exiting so PM2 restarts the worker.');
    process.exit(1);
  });

  const worker = new Worker(
    'todo-reminders',
    (job) => processTodoReminderJob(job),
    {
      connection: redisConnection as any,
      concurrency: 5,
    }
  );

  worker.on('active', (job) => {
    reminderPipelineLog('worker.job_active', {
      jobId: job.id,
      todoId: (job.data as { todoId?: string })?.todoId,
    });
  });

  worker.on('completed', (job) => {
    reminderPipelineLog('worker.job_completed', { jobId: job.id });
    console.log(`[Todo Reminder Worker] Job ${job.id} completed`);
  });

  worker.on('failed', (job, err) => {
    const todoId = (job?.data as { todoId?: string } | undefined)?.todoId;
    logTodoReminder('worker', 'failed', {
      phase: 'bullmq_failed_event',
      jobId: job?.id,
      todoId,
      error: err?.message ?? String(err),
      attemptsMade: job?.attemptsMade,
    });
    console.error(`[Todo Reminder Worker] Job ${job?.id} failed:`, err);
  });

  console.log('[Todo Reminder Worker] Started and listening for jobs');

  // Handle graceful shutdown
  process.on('SIGTERM', async () => {
    console.log('[Todo Reminder Worker] SIGTERM received, closing worker...');
    await worker.close();
    process.exit(0);
  });

  process.on('SIGINT', async () => {
    console.log('[Todo Reminder Worker] SIGINT received, closing worker...');
    await worker.close();
    process.exit(0);
  });
}

// Start the worker
startWorker().catch((err) => {
  console.error('[Todo Reminder Worker] Failed to start:', err);
  process.exit(1);
});
