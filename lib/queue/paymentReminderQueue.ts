import { Queue, Worker, type Job } from 'bullmq';
import Redis from 'ioredis';
import {
  deliverPaymentReminder,
  type PaymentReminderJobData,
} from '@/lib/payment-reminder-delivery';
import type { BusinessTransport } from '@/lib/whatsapp/business-transport';
import { BAILEYS_SCHEDULED_GAP_MS, randomGapMs, sleep } from '@/lib/whatsapp/baileys-pacing';

/**
 * Scheduled payment reminders. The cron route enqueues one job per invoice and this worker sends
 * them. The worker MUST run inside the Next.js server process: QR (Baileys) sockets live in that
 * process's memory, and a sender in another process would open a second socket for the same
 * number, which WhatsApp treats as "connection replaced" and logs the business out.
 */
export const PAYMENT_REMINDER_QUEUE = 'payment-reminders';

export interface PaymentReminderQueueJob extends PaymentReminderJobData {
  transport: BusinessTransport;
}

const NEXT_SLOT_KEY = (businessId: string) => `${PAYMENT_REMINDER_QUEUE}:next-slot:${businessId}`;

type State = {
  queueConnection: Redis | null;
  queue: Queue<PaymentReminderQueueJob> | null;
  worker: Worker<PaymentReminderQueueJob> | null;
  businessLocks: Map<string, Promise<void>>;
  lastBaileysSendAt: Map<string, number>;
};

const globalKey = '__khatarioPaymentReminderQueue' as const;
const g = globalThis as unknown as { [globalKey]?: State };
const state: State = (g[globalKey] ??= {
  queueConnection: null,
  queue: null,
  worker: null,
  businessLocks: new Map(),
  lastBaileysSendAt: new Map(),
});

export function isPaymentReminderQueueConfigured(): boolean {
  return Boolean(process.env.REDIS_URL) && process.env.PAYMENT_REMINDER_QUEUE_DISABLED !== '1';
}

function waitForReady(client: Redis, timeoutMs: number): Promise<boolean> {
  if (client.status === 'ready') return Promise.resolve(true);
  return new Promise((resolve) => {
    const done = (ok: boolean) => {
      clearTimeout(timer);
      client.off('ready', onReady);
      resolve(ok);
    };
    const onReady = () => done(true);
    const timer = setTimeout(() => done(client.status === 'ready'), timeoutMs);
    client.on('ready', onReady);
  });
}

/** Enqueue side fails fast (no offline queue) so the cron can fall back to sending inline. */
async function getQueue(): Promise<Queue<PaymentReminderQueueJob> | null> {
  if (!isPaymentReminderQueueConfigured()) return null;
  if (!state.queueConnection) {
    state.queueConnection = new Redis(process.env.REDIS_URL!, {
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
      connectTimeout: 5000,
      retryStrategy: (times) => Math.min(times * 1000, 30_000),
    });
    state.queueConnection.on('error', () => undefined);
  }
  if (!(await waitForReady(state.queueConnection, 5000))) return null;
  state.queue ??= new Queue<PaymentReminderQueueJob>(PAYMENT_REMINDER_QUEUE, {
    connection: state.queueConnection as never,
  });
  return state.queue;
}

/**
 * Delays (ms from now) for `count` QR sends, continuing after any slot already booked for the
 * business by an earlier run so two overlapping runs never send back-to-back.
 */
export function planBaileysDelays(
  now: number,
  bookedUntil: number | null,
  count: number,
  gap: () => number = () => randomGapMs(BAILEYS_SCHEDULED_GAP_MS),
): { delays: number[]; nextSlot: number } {
  let slot = Math.max(now, bookedUntil ?? 0);
  const delays: number[] = [];
  for (let i = 0; i < count; i++) {
    delays.push(slot - now);
    slot += gap();
  }
  return { delays, nextSlot: slot };
}

export function paymentReminderJobId(job: Pick<PaymentReminderJobData, 'kind' | 'invoiceId'>): string {
  return `pr-${job.kind}-${job.invoiceId}`;
}

/**
 * Queues reminders for one business. Returns how many were newly queued (an invoice that is
 * already waiting in the queue is not queued twice), or null when the queue is unavailable and
 * the caller should send inline instead.
 */
export async function enqueuePaymentReminders(
  businessId: string,
  transport: BusinessTransport,
  jobs: PaymentReminderJobData[],
): Promise<number | null> {
  if (jobs.length === 0) return 0;
  const queue = await getQueue();
  if (!queue) return null;

  try {
    const fresh: PaymentReminderJobData[] = [];
    for (const job of jobs) {
      if (!(await queue.getJob(paymentReminderJobId(job)))) fresh.push(job);
    }
    if (fresh.length === 0) return 0;

    let delays = fresh.map(() => 0);
    if (transport === 'baileys') {
      const conn = state.queueConnection!;
      const now = Date.now();
      const booked = Number(await conn.get(NEXT_SLOT_KEY(businessId))) || null;
      const plan = planBaileysDelays(now, booked, fresh.length);
      delays = plan.delays;
      await conn.set(NEXT_SLOT_KEY(businessId), String(plan.nextSlot), 'PX', plan.nextSlot - now + 3_600_000);
    }

    await queue.addBulk(
      fresh.map((job, i) => ({
        name: job.kind,
        data: { ...job, transport },
        opts: {
          jobId: paymentReminderJobId(job),
          delay: delays[i],
          attempts: 3,
          backoff: { type: 'exponential', delay: 5000 },
          removeOnComplete: true,
          removeOnFail: true,
        },
      })),
    );
    return fresh.length;
  } catch (error) {
    console.error(`[Payment Reminder Queue] Enqueue failed for business ${businessId}:`, error);
    return null;
  }
}

/** Serialises QR sends per business and enforces the minimum gap even if delays collapse. */
async function withBaileysPacing<T>(businessId: string, fn: () => Promise<T>): Promise<T> {
  const previous = state.businessLocks.get(businessId) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((r) => (release = r));
  const chained = previous.then(() => current);
  state.businessLocks.set(businessId, chained);
  await previous;
  try {
    const last = state.lastBaileysSendAt.get(businessId);
    const wait = last ? last + BAILEYS_SCHEDULED_GAP_MS.min - Date.now() : 0;
    if (wait > 0) await sleep(wait);
    return await fn();
  } finally {
    state.lastBaileysSendAt.set(businessId, Date.now());
    release();
    if (state.businessLocks.get(businessId) === chained) state.businessLocks.delete(businessId);
  }
}

export async function processPaymentReminderJob(data: PaymentReminderQueueJob) {
  const run = () => deliverPaymentReminder(data);
  const result = data.transport === 'baileys' ? await withBaileysPacing(data.businessId, run) : await run();
  if (result.outcome !== 'sent') {
    console.log(
      `[Payment Reminder Queue] ${data.kind} reminder for invoice ${data.invoiceId} ${result.outcome}: ${result.reason}`,
    );
  }
  return result;
}

/**
 * Starts the worker once per server process. Called by the reminder cron route, which runs in the
 * same process as the QR sockets; after a restart, delayed jobs resume on the next cron tick.
 */
export function ensurePaymentReminderWorker(): boolean {
  if (state.worker) return true;
  if (!isPaymentReminderQueueConfigured() || process.env.PAYMENT_REMINDER_WORKER_DISABLED === '1') {
    return false;
  }
  const connection = new Redis(process.env.REDIS_URL!, {
    maxRetriesPerRequest: null,
    retryStrategy: (times) => Math.min(times * 1000, 30_000),
  });
  connection.on('error', () => undefined);

  const concurrency = Math.max(1, Number(process.env.PAYMENT_REMINDER_CONCURRENCY) || 4);
  state.worker = new Worker<PaymentReminderQueueJob>(
    PAYMENT_REMINDER_QUEUE,
    (job: Job<PaymentReminderQueueJob>) => processPaymentReminderJob(job.data),
    { connection: connection as never, concurrency },
  );
  state.worker.on('failed', (job, err) => {
    console.error(`[Payment Reminder Queue] Job ${job?.id} failed:`, err?.message);
  });
  state.worker.on('error', (err) => {
    console.error('[Payment Reminder Queue] Worker error:', err?.message);
  });
  console.log(`[Payment Reminder Queue] Worker started in server process (concurrency=${concurrency})`);
  return true;
}
