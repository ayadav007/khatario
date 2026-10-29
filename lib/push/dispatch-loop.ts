import type { Client } from 'pg';
import { getPool } from '@/lib/db';
import { dispatchPushJobs, type DispatchSummary } from './dispatcher';

export type DispatchLoopOptions = {
  /** Fallback poll when no LISTEN wake-up arrives (a job scheduled for retry needs this). */
  intervalMs?: number;
  /** Jobs per round. */
  limit?: number;
  log?: (event: string, fields: Record<string, unknown>) => void;
};

/**
 * Runs the push dispatcher in a long-lived process (the todo-reminder worker). A dedicated
 * PostgreSQL connection LISTENs on `push_jobs` (the outbox trigger and the customer enqueue both
 * NOTIFY), so a new job is sent within a second; the interval catches retries and anything a
 * dropped LISTEN connection missed. Rounds never overlap inside one process; across processes
 * the SKIP LOCKED claim keeps them apart.
 */
export function startPushDispatchLoop(options: DispatchLoopOptions = {}): { stop: () => Promise<void> } {
  const intervalMs = options.intervalMs ?? 10_000;
  const limit = options.limit ?? 50;
  const log = options.log ?? ((event, fields) => console.log(JSON.stringify({ scope: 'push', event, ...fields })));
  let running = false;
  let again = false;
  let stopped = false;
  let listener: Client | null = null;

  const round = async (): Promise<DispatchSummary | null> => {
    if (stopped) return null;
    if (running) {
      again = true;
      return null;
    }
    running = true;
    try {
      let summary: DispatchSummary;
      do {
        again = false;
        summary = await dispatchPushJobs({ limit, log });
        if (summary.claimed > 0) log('round', { ...summary });
      } while ((again || summary.claimed === limit) && !stopped);
      return summary;
    } catch (err) {
      log('round_error', { error: err instanceof Error ? err.message : String(err) });
      return null;
    } finally {
      running = false;
    }
  };

  const timer = setInterval(() => void round(), intervalMs);
  void round();

  const listen = async () => {
    try {
      const client = (await getPool().connect()) as unknown as Client;
      listener = client;
      client.on('notification', () => void round());
      client.on('error', () => {
        /* the interval keeps the loop alive; the connection is replaced on stop/restart */
      });
      await client.query('LISTEN push_jobs');
      log('listening', { channel: 'push_jobs', intervalMs });
    } catch (err) {
      log('listen_failed', { error: err instanceof Error ? err.message : String(err), intervalMs });
    }
  };
  void listen();

  return {
    async stop() {
      stopped = true;
      clearInterval(timer);
      const c = listener as (Client & { release?: () => void }) | null;
      listener = null;
      if (c) {
        await c.query('UNLISTEN push_jobs').catch(() => undefined);
        c.release?.();
      }
    },
  };
}
