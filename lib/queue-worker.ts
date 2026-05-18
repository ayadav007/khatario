import { Worker, Job, type ConnectionOptions, UnrecoverableError, QueueEvents } from 'bullmq';
import { getBullConnection, getWhatsAppQueue, WHATSAPP_QUEUE_NAME, isWhatsAppQueueEnabled } from './queue';
import { processWhatsAppMessageJob } from './whatsapp-queue-processor';
import type { WhatsAppMessageJob } from './whatsapp-queue-types';
import { withConversationOrder, buildWhatsAppOrderKey } from './whatsapp-conversation-order';
import { WhatsAppQueueJobError, classifyErrorRetryable } from './whatsapp-queue-errors';

let worker: Worker<WhatsAppMessageJob> | null = null;
let queueEvents: QueueEvents | null = null;

const concurrency = Math.max(1, parseInt(process.env.WHATSAPP_QUEUE_CONCURRENCY || '1', 10));

function toUnrecoverableError(err: unknown): UnrecoverableError {
  if (err instanceof UnrecoverableError) {
    return err;
  }
  const m = err instanceof Error ? err.message : String(err);
  return new UnrecoverableError(m);
}

/**
 * Start BullMQ worker (same process or dedicated worker process).
 * Concurrency N > 1 is safe: same `orderKey` is serialized via withConversationOrder;
 * different conversations run in parallel.
 */
export function startWhatsAppMessageWorker(): Worker<WhatsAppMessageJob> | null {
  if (!isWhatsAppQueueEnabled() || process.env.WHATSAPP_DISABLE_WORKER === '1') {
    return null;
  }
  if (worker) {
    return worker;
  }

  const q = getWhatsAppQueue()!;
  const eventsConn = getBullConnection().duplicate();
  if (!queueEvents) {
    queueEvents = new QueueEvents(WHATSAPP_QUEUE_NAME, {
      connection: eventsConn as ConnectionOptions
    });
    void (async () => {
      try {
        await queueEvents!.waitUntilReady();
        queueEvents!.on('retries-exhausted', async (args) => {
          const j = await Job.fromId(q, args.jobId);
          if (!j) {
            return;
          }
          const d = j.data;
          console.error('[WA] job permanently failed', {
            jobId: args.jobId,
            messageId: d.messageId,
            type: d.type,
            attemptsMade: args.attemptsMade,
            error: j.failedReason
          });
        });
      } catch (e) {
        console.error('[BullMQ] QueueEvents init failed', e);
      }
    })();
  }

  worker = new Worker<WhatsAppMessageJob>(
    WHATSAPP_QUEUE_NAME,
    async (job: Job<WhatsAppMessageJob>) => {
      const orderKey =
        job.data.orderKey ?? buildWhatsAppOrderKey(job.data.businessId, job.data.conversationId);
      if (job.attemptsMade > 0) {
        console.log('[WA] retry attempt', {
          id: job.id,
          type: job.data.type,
          attemptsMade: job.attemptsMade
        });
      }
      return withConversationOrder(orderKey, async () => {
        console.log('[WA] job started', {
          id: job.id,
          type: job.data.type,
          orderKey
        });
        try {
          await processWhatsAppMessageJob(job.data);
          console.log('[WA] job completed', { id: job.id, type: job.data.type });
        } catch (e) {
          console.error('[WA] job failed', { id: job.id, type: job.data.type, err: e });
          if (e instanceof UnrecoverableError) {
            throw e;
          }
          if (e instanceof WhatsAppQueueJobError && !e.retryable) {
            console.error('[WA] job permanently failed', {
              messageId: job.data.messageId,
              type: job.data.type,
              error: e.message
            });
            throw toUnrecoverableError(e);
          }
          if (!classifyErrorRetryable(e)) {
            const msg = e instanceof Error ? e.message : String(e);
            console.error('[WA] job permanently failed', {
              messageId: job.data.messageId,
              type: job.data.type,
              error: msg
            });
            throw toUnrecoverableError(e);
          }
          throw e;
        }
      });
    },
    {
      connection: getBullConnection() as ConnectionOptions,
      concurrency
    }
  );

  worker.on('failed', (job, err) => {
    console.error('[BullMQ] job failed (worker event)', { id: job?.id, err });
  });
  worker.on('completed', (j) => {
    console.log('[BullMQ] job completed (worker event)', { id: j.id });
  });

  return worker;
}
