import { Queue } from 'bullmq';
import { getRedisConnection, waitForRedisReady } from '@/lib/queue/redis';
import { reindex, summarizeReport, type ReindexTarget } from './ingest/run';

export const KB_INDEX_QUEUE = 'kb-index';
export const KB_NIGHTLY_SCHEDULER = 'kb-nightly';

export interface KbIndexJob {
  target: ReindexTarget;
  locator?: string;
  force?: boolean;
  reason: string;
}

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
      const report = await reindex({ target: job.target, locator: job.locator, force: job.force });
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
          jobId: `kb-${job.target}-${(job.locator ?? 'all').replace(/[^a-zA-Z0-9_-]/g, '_')}`,
          delay: 5_000,
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
