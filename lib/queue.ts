import { Queue, type ConnectionOptions } from 'bullmq';
import IORedis from 'ioredis';
import type { WhatsAppMessageJob } from './whatsapp-queue-types';
import { buildWhatsAppOrderKey } from './whatsapp-conversation-order';

export const WHATSAPP_QUEUE_NAME = 'whatsapp-messages';

const defaultJobOptions = {
  attempts: 3,
  backoff: { type: 'exponential' as const, delay: 2000 },
  removeOnComplete: true,
  removeOnFail: false
};

let connection: IORedis | null = null;
let sharedQueue: Queue | null = null;

export function isWhatsAppQueueEnabled(): boolean {
  if (process.env.WHATSAPP_DISABLE_QUEUE === '1' || process.env.WHATSAPP_DISABLE_QUEUE === 'true') {
    return false;
  }
  return !!process.env.REDIS_HOST;
}

function createConnection(): IORedis {
  return new IORedis({
    host: process.env.REDIS_HOST || '127.0.0.1',
    port: parseInt(process.env.REDIS_PORT || '6379', 10),
    password: process.env.REDIS_PASSWORD || undefined,
    maxRetriesPerRequest: null
  });
}

/** BullMQ + BullMQ IORedis connection (do not use for arbitrary Redis keys elsewhere without another client). */
export function getBullConnection(): IORedis {
  if (!connection) {
    connection = createConnection();
  }
  return connection;
}

export function getWhatsAppQueue(): Queue | null {
  if (!isWhatsAppQueueEnabled()) {
    return null;
  }
  if (!sharedQueue) {
    sharedQueue = new Queue(WHATSAPP_QUEUE_NAME, {
      connection: getBullConnection() as ConnectionOptions,
      defaultJobOptions
    });
  }
  return sharedQueue;
}

/** Dedupe id: businessId:messageId:flowType (colons in messageId → _). */
export function jobIdForWhatsAppJob(data: WhatsAppMessageJob): string {
  const flow = data.type;
  const mid = (data.messageId || `noid_${Date.now()}`).replace(/:/g, '_');
  return `${data.businessId}:${mid}:${flow}`;
}

function withOrderKey(data: WhatsAppMessageJob): WhatsAppMessageJob {
  const orderKey = data.orderKey ?? buildWhatsAppOrderKey(data.businessId, data.conversationId);
  return { ...data, orderKey };
}

/**
 * Enqueue or run inline: if Redis/queue disabled or add fails, runs processor in-process.
 */
export async function addWhatsAppMessageJob(data: WhatsAppMessageJob): Promise<void> {
  const { processWhatsAppMessageJob } = await import('./whatsapp-queue-processor');
  const enriched = withOrderKey(data);
  const q = getWhatsAppQueue();

  if (!q) {
    if (enriched.type === 'webhook') {
      void processWhatsAppMessageJob(enriched).catch((e) => {
        console.error('[WA] webhook job (inline) failed', e);
      });
      return;
    }
    await processWhatsAppMessageJob(enriched);
    return;
  }

  const id = jobIdForWhatsAppJob(enriched);

  try {
    await q.add('process-message', enriched, {
      jobId: id,
      ...defaultJobOptions
    });
    console.log('[WA] job queued', {
      jobId: id,
      type: enriched.type,
      orderKey: enriched.orderKey
    });
  } catch (e) {
    console.error('[BullMQ] queue.add failed, processing directly', e);
    if (enriched.type === 'webhook') {
      void processWhatsAppMessageJob(enriched).catch((err) => {
        console.error('[WA] webhook direct process failed', err);
      });
      return;
    }
    await processWhatsAppMessageJob(enriched);
  }
}

export { defaultJobOptions };
