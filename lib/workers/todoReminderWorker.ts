// Load environment variables
import dotenv from 'dotenv';
import path from 'path';

// Try to load .env.local first, then .env
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

import { Worker } from 'bullmq';
import { getRedisConnection } from '../queue/redis';
import { queryOne } from '../db';
import {
  triggerTodoReminder,
  type TodoForReminder,
} from '../services/todoReminderService';
import { reminderPipelineLog } from '@/lib/reminder-pipeline-log';
import { logTodoReminder } from '../todo-reminders/reminderLog';

// Initialize worker
async function startWorker() {
  console.log('========================================');
  console.log('[Todo Reminder Worker] Starting BullMQ Worker...');
  console.log('========================================');
  
  // Get Redis connection
  const redisConnection = getRedisConnection();

  if (!redisConnection) {
    console.error('[Todo Reminder Worker] Redis connection not available. Please ensure Redis/Memurai is running and REDIS_URL is set in .env');
    process.exit(1);
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
    console.error('[Todo Reminder Worker] Failed to connect to Redis.');
    console.error('[Todo Reminder Worker] Please ensure Memurai is running on localhost:6379');
    console.error('[Todo Reminder Worker] Error:', err.message);
    console.error('[Todo Reminder Worker] Exiting...');
    process.exit(1);
  }

  const worker = new Worker(
    'todo-reminders',
    async (job) => {
      reminderPipelineLog('worker.job_received', {
        jobId: job.id,
        todoId: (job.data as { todoId?: string })?.todoId,
      });
      const { todoId } = job.data as { todoId?: string };
      if (!todoId) {
        const err = new Error('todo-reminders job missing todoId');
        logTodoReminder('worker', 'failed', {
          jobId: job.id,
          reason: 'missing_todoId',
          error: err.message,
        });
        throw err;
      }

      const todo = await queryOne<TodoForReminder>(
        `SELECT * FROM todos WHERE id = $1`,
        [todoId]
      );

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

        if (result.status === 'invalid') {
          logTodoReminder('worker', 'skipped', {
            todoId,
            jobId: job.id,
            businessId: todo.business_id,
            reason: result.reason,
            outcome: 'invalid',
          });
          return;
        }

        logTodoReminder('worker', 'skipped', {
          todoId,
          jobId: job.id,
          businessId: todo.business_id,
          reason: result.reason,
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
    },
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
