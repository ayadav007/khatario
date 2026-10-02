import { Queue } from 'bullmq';
import { getRedisConnection, waitForRedisReady } from '@/lib/queue/redis';
import { reindex, summarizeReport, type ReindexTarget } from './ingest/run';

export const KB_INDEX_QUEUE = 'kb-index';
export const KB_NIGHTLY_SCHEDULER = 'kb-nightly';

export interface KbIndexJob {
  target: ReindexTarget;
  locator?: string;
  businessId?: string;
  force?: boolean;
  reason: string;
}

/** Item and store edits come in bursts (bulk import, editing several products): wait, then index once. */
export const TENANT_REINDEX_DELAY_MS = 60_000;

export interface KbNightlyJob {
  nightly: true;
}

let queue: Queue | null = null;

function getQueue(): Queue | null {
  const connection = getRedisConnection();
  if (!connection || connection.status !== 'ready') {
    if (queue) {
      const q = queue;
      queue = null;
      void q.close().catch(() => undefined);
    }
    return null;
  }
  if (!queue) queue = new Queue(KB_INDEX_QUEUE, { connection: connection as never });
  return queue;
}

/** Serialises inline runs so two admin saves in a row don't index the same source concurrently. */
let inlineChain: Promise<unknown> = Promise.resolve();

function runInline(job: KbIndexJob): void {
  inlineChain = inlineChain
    .then(async () => {
      const report = await reindex({ target: job.target, locator: job.locator, businessId: job.businessId, force: job.force });
      const summary = summarizeReport(report).replace(/\n/g, ' | ');
      if (report.errors.length) console.warn(`[kb-index] inline ${job.reason}: ${summary}`);
      else console.log(`[kb-index] inline ${job.reason}: ${summary}`);
    })
    .catch((err) => console.error(`[kb-index] inline ${job.reason} failed:`, err instanceof Error ? err.message : err));
}

/**
 * Queue a knowledge re-index after an admin change. Never throws: an indexing hiccup must not fail
 * the admin save that triggered it. Without Redis the job runs in this process in the background.
 */
export async function enqueueKbReindex(job: KbIndexJob): Promise<'queued' | 'inline'> {
  try {
    if (await waitForRedisReady(2000)) {
      const q = getQueue();
      if (q) {
        // Same jobId while a job is waiting collapses bursts of edits into one run.
        await q.add('reindex', job, {
          jobId: `kb-${job.target}-${(job.businessId ?? job.locator ?? 'all').replace(/[^a-zA-Z0-9_-]/g, '_')}`,
          delay: job.target === 'tenant' ? TENANT_REINDEX_DELAY_MS : 5_000,
          attempts: 3,
          backoff: { type: 'exponential', delay: 30_000 },
          removeOnComplete: true,
          removeOnFail: 50,
        });
        return 'queued';
      }
    }
  } catch (err) {
    console.warn('[kb-index] queue unavailable, indexing inline:', err instanceof Error ? err.message : err);
  }
  runInline(job);
  return 'inline';
}

/** Fire-and-forget wrapper for route handlers. */
export function scheduleKbReindex(job: KbIndexJob): void {
  void enqueueKbReindex(job);
}

const tenantTimers = new Map<string, ReturnType<typeof setTimeout>>();

/**
 * Re-index one shop's catalog and policies after an item or store-settings change. Debounced per
 * business in this process (and by job id in the queue), so a bulk edit indexes once. Never throws.
 */
export function scheduleTenantReindex(businessId: string, reason: string): void {
  if (!businessId) return;
  const existing = tenantTimers.get(businessId);
  if (existing) clearTimeout(existing);
  const timer = setTimeout(() => {
    tenantTimers.delete(businessId);
    void enqueueTenantNow(businessId, reason);
  }, 2_000);
  if (typeof timer === 'object' && 'unref' in timer) timer.unref();
  tenantTimers.set(businessId, timer);
}

async function enqueueTenantNow(businessId: string, reason: string) {
  try {
    if (await waitForRedisReady(2000)) {
      const q = getQueue();
      if (q) {
        const jobId = `kb-tenant-${businessId}`;
        // A waiting (delayed) job already covers this edit.
        const existing = await q.getJob(jobId).catch(() => null);
        if (existing && (await existing.isDelayed().catch(() => false))) return;
        // A running job may have read the data before this edit; it can't be removed, so queue another.
        const removed = existing ? await existing.remove().then(() => true, () => false) : true;
        await q.add('reindex', { target: 'tenant', businessId, reason } satisfies KbIndexJob, {
          jobId: removed ? jobId : `${jobId}-${Date.now()}`,
          delay: TENANT_REINDEX_DELAY_MS,
          attempts: 2,
          backoff: { type: 'exponential', delay: 60_000 },
          removeOnComplete: true,
          removeOnFail: 50,
        });
        return;
      }
    }
  } catch (err) {
    console.warn('[kb-index] tenant queue unavailable, indexing inline:', err instanceof Error ? err.message : err);
  }
  inlineTenantLater(businessId, reason);
}

const inlineTenantTimers = new Map<string, ReturnType<typeof setTimeout>>();

function inlineTenantLater(businessId: string, reason: string) {
  const existing = inlineTenantTimers.get(businessId);
  if (existing) clearTimeout(existing);
  const timer = setTimeout(() => {
    inlineTenantTimers.delete(businessId);
    runInline({ target: 'tenant', businessId, reason });
  }, TENANT_REINDEX_DELAY_MS);
  if (typeof timer === 'object' && 'unref' in timer) timer.unref();
  inlineTenantTimers.set(businessId, timer);
}
