/**
 * Assistant knowledge index worker.
 *
 *   npm run worker:kb
 *
 * Processes `kb-index` jobs queued by admin saves (plans, limits, features, site-builder publish)
 * and registers a nightly 03:00 IST job that re-indexes everything and purges old conversations.
 */
import { existsSync } from 'fs';
import { resolve } from 'path';
import { config as loadEnv } from 'dotenv';
import { Queue, Worker, type Job } from 'bullmq';
import { getRedisConnection, waitForRedisReady } from '@/lib/queue/redis';
import { closePool } from '@/lib/db';
import { reindex, summarizeReport } from '@/lib/rag/ingest/run';
import { purgeOldConversations } from '@/lib/rag/retention';
import { KB_INDEX_QUEUE, KB_NIGHTLY_SCHEDULER, type KbIndexJob, type KbNightlyJob } from '@/lib/rag/queue';

const LOG = '[KB Index Worker]';

async function processJob(job: Job<KbIndexJob | KbNightlyJob>): Promise<string> {
  if ('nightly' in job.data) {
    const report = await reindex({ target: 'all' });
    const purged = await purgeOldConversations();
    const summary = `${summarizeReport(report).replace(/\n/g, ' | ')} | purged conversations: ${purged}`;
    console.log(`${LOG} nightly: ${summary}`);
    if (report.errors.length) throw new Error(summary);
    return summary;
  }
  const { target, locator, force, reason } = job.data;
  const report = await reindex({ target, locator, force });
  const summary = summarizeReport(report).replace(/\n/g, ' | ');
  console.log(`${LOG} ${reason} (${target}${locator ? `:${locator}` : ''}): ${summary}`);
  if (report.errors.length) throw new Error(summary);
  return summary;
}

async function main() {
  // The npm script preloads .env.local; VPS clones keep REDIS_URL and DB settings in .env.production.
  for (const file of ['.env.local', '.env.production', '.env']) {
    const path = resolve(process.cwd(), file);
    if (existsSync(path)) loadEnv({ path, override: false });
  }
  if (!getRedisConnection() || !(await waitForRedisReady(10_000))) {
    console.error(`${LOG} Redis is not reachable. Set REDIS_URL and start Redis/Memurai.`);
    process.exit(1);
  }
  const connection = getRedisConnection()!;

  const queue = new Queue(KB_INDEX_QUEUE, { connection: connection as never });
  await queue.upsertJobScheduler(
    KB_NIGHTLY_SCHEDULER,
    { pattern: '0 3 * * *', tz: 'Asia/Kolkata' },
    { name: 'nightly', data: { nightly: true }, opts: { removeOnComplete: 10, removeOnFail: 20 } },
  );

  // Concurrency 1: runs touch the same kb_sources rows and share one embedding quota.
  const worker = new Worker<KbIndexJob | KbNightlyJob>(KB_INDEX_QUEUE, processJob, {
    connection: connection as never,
    concurrency: 1,
  });
  worker.on('failed', (job, err) => console.error(`${LOG} job ${job?.id} failed:`, err?.message ?? err));
  console.log(`${LOG} listening on "${KB_INDEX_QUEUE}" (nightly 03:00 IST)`);

  const shutdown = async () => {
    await worker.close();
    await queue.close();
    await closePool().catch(() => undefined);
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((err) => {
  console.error(`${LOG} failed to start:`, err);
  process.exit(1);
});
