import type { PoolClient } from 'pg';
import { getPool, query, queryRows } from '@/lib/db';
import { revokeDeviceById } from './device-registry';
import { classifyPushError, nextRetryDelayMs, PUSH_MAX_ATTEMPTS } from './errors';
import { fcmUnavailableReason, getPushSender } from './fcm';
import { buildPushMessage } from './payload';
import type { PushDeviceRow, PushJobRow, PushSender } from './types';

export type DispatchOptions = {
  /** Jobs claimed per call. */
  limit?: number;
  sender?: PushSender | null;
  now?: () => Date;
  log?: (event: string, fields: Record<string, unknown>) => void;
};

export type DispatchSummary = {
  claimed: number;
  sent: number;
  retried: number;
  failed: number;
  skipped: number;
  devices: number;
  accepted: number;
  invalidTokens: number;
};

/** A claim older than this is a worker that died mid-send; the job becomes claimable again. */
const STALE_LOCK_MS = 5 * 60_000;

function defaultLog(event: string, fields: Record<string, unknown>): void {
  console.log(JSON.stringify({ scope: 'push', event, ...fields, ts: new Date().toISOString() }));
}

/**
 * Claims up to `limit` due jobs for this worker. FOR UPDATE SKIP LOCKED means two workers never
 * take the same row; `locked_at` makes a claim visible to later runs and lets a stale one expire.
 */
async function claimJobs(client: PoolClient, limit: number): Promise<PushJobRow[]> {
  const r = await client.query<PushJobRow>(
    `WITH due AS (
       SELECT id FROM push_jobs
        WHERE status = 'pending'
          AND next_attempt_at <= CURRENT_TIMESTAMP
          AND (locked_at IS NULL OR locked_at < CURRENT_TIMESTAMP - make_interval(secs => $2))
        ORDER BY next_attempt_at, created_at
        LIMIT $1
        FOR UPDATE SKIP LOCKED
     )
     UPDATE push_jobs j
        SET locked_at = CURRENT_TIMESTAMP, attempts = j.attempts + 1
       FROM due
      WHERE j.id = due.id
      RETURNING j.id, j.kind, j.audience, j.notification_id, j.notification_seq::text AS notification_seq,
                j.business_id, j.user_id, j.customer_id, j.title, j.body, j.data, j.status, j.attempts,
                j.next_attempt_at::text AS next_attempt_at, j.last_error, j.sent_count`,
    [limit, STALE_LOCK_MS / 1000],
  );
  return r.rows;
}

/**
 * Devices that may receive this job. The rule is the audience boundary from migration 445:
 * - business jobs go to business devices of members of that business (one user, or every
 *   active member through users.business_id or user_businesses), never to customer devices;
 * - customer jobs go to that store customer's devices registered for that shop only.
 * A business device whose session version no longer matches the user's is revoked here instead
 * of being sent to: the phone was signed out (or replaced on a single-device plan).
 */
export async function resolveJobDevices(job: PushJobRow): Promise<{ devices: PushDeviceRow[]; staleDeviceIds: string[] }> {
  if (job.audience === 'customer') {
    if (!job.customer_id) return { devices: [], staleDeviceIds: [] };
    const devices = await queryRows<PushDeviceRow>(
      `SELECT d.id, d.audience, d.user_id, d.customer_id, d.business_id, d.app_id, d.platform, d.token, d.token_hash,
              d.session_version
         FROM push_devices d
         JOIN store_customers c ON c.id = d.customer_id AND c.business_id = d.business_id
        WHERE d.audience = 'customer' AND d.revoked_at IS NULL
          AND d.customer_id = $1 AND d.business_id = $2`,
      [job.customer_id, job.business_id],
    );
    return { devices, staleDeviceIds: [] };
  }

  const rows = await queryRows<PushDeviceRow & { current_version: string | null }>(
    `SELECT d.id, d.audience, d.user_id, d.customer_id, d.business_id, d.app_id, d.platform, d.token, d.token_hash,
            d.session_version, u.auth_session_version::text AS current_version
       FROM push_devices d
       JOIN users u ON u.id = d.user_id AND u.is_active = true
      WHERE d.audience = 'business' AND d.revoked_at IS NULL
        AND ($2::uuid IS NULL OR d.user_id = $2::uuid)
        AND (
          u.business_id = $1
          OR EXISTS (SELECT 1 FROM user_businesses ub WHERE ub.user_id = u.id AND ub.business_id = $1)
        )`,
    [job.business_id, job.user_id],
  );
  const devices: PushDeviceRow[] = [];
  const staleDeviceIds: string[] = [];
  for (const row of rows) {
    const current = row.current_version == null ? null : Number(row.current_version);
    if (row.session_version != null && current != null && row.session_version !== current) {
      staleDeviceIds.push(row.id);
      continue;
    }
    devices.push(row);
  }
  return { devices, staleDeviceIds };
}

async function finishJob(
  jobId: string,
  status: 'sent' | 'failed' | 'skipped',
  error: string | null,
  sentCount: number,
): Promise<void> {
  await query(
    `UPDATE push_jobs
        SET status = $2, last_error = $3, sent_count = sent_count + $4, locked_at = NULL, finished_at = CURRENT_TIMESTAMP
      WHERE id = $1`,
    [jobId, status, error ? error.slice(0, 200) : null, sentCount],
  );
}

async function retryJob(jobId: string, attempts: number, error: string, sentCount: number): Promise<boolean> {
  const delay = attempts < PUSH_MAX_ATTEMPTS ? nextRetryDelayMs(attempts) : null;
  if (delay == null) {
    await finishJob(jobId, 'failed', `${error} (gave up after ${attempts} attempts)`, sentCount);
    return false;
  }
  await query(
    `UPDATE push_jobs
        SET next_attempt_at = CURRENT_TIMESTAMP + make_interval(secs => $3), last_error = $2,
            sent_count = sent_count + $4, locked_at = NULL
      WHERE id = $1`,
    [jobId, error.slice(0, 200), delay / 1000, sentCount],
  );
  return true;
}

/** Devices this job already reached in an earlier attempt are not sent to again. */
async function alreadyAccepted(jobId: string): Promise<Set<string>> {
  const rows = await queryRows<{ device_id: string | null }>(
    `SELECT device_id FROM push_deliveries WHERE job_id = $1 AND status = 'accepted' AND device_id IS NOT NULL`,
    [jobId],
  );
  return new Set(rows.map((r) => r.device_id as string));
}

/**
 * One dispatch round. Safe to call from several processes at once and from the cron route.
 * Returns counts only; nothing in the summary or the log lines contains a token or a body.
 */
export async function dispatchPushJobs(options: DispatchOptions = {}): Promise<DispatchSummary> {
  const limit = options.limit ?? 50;
  const log = options.log ?? defaultLog;
  const summary: DispatchSummary = { claimed: 0, sent: 0, retried: 0, failed: 0, skipped: 0, devices: 0, accepted: 0, invalidTokens: 0 };

  const client = await getPool().connect();
  let jobs: PushJobRow[];
  try {
    await client.query('BEGIN');
    jobs = await claimJobs(client, limit);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
  summary.claimed = jobs.length;
  if (jobs.length === 0) return summary;

  const sender = options.sender === undefined ? getPushSender() : options.sender;

  for (const job of jobs) {
    try {
      const { devices, staleDeviceIds } = await resolveJobDevices(job);
      for (const id of staleDeviceIds) await revokeDeviceById(id, 'session_ended');

      const done = await alreadyAccepted(job.id);
      const targets = devices.filter((d) => !done.has(d.id));
      if (targets.length === 0) {
        await finishJob(job.id, done.size > 0 ? 'sent' : 'skipped', done.size > 0 ? null : 'no_devices', 0);
        summary.skipped += done.size > 0 ? 0 : 1;
        summary.sent += done.size > 0 ? 1 : 0;
        continue;
      }
      summary.devices += targets.length;

      if (!sender) {
        const reason = fcmUnavailableReason() || 'fcm_not_configured';
        await finishJob(job.id, 'failed', reason, 0);
        summary.failed += 1;
        log('job_failed', { jobId: job.id, businessId: job.business_id, devices: targets.length, reason });
        continue;
      }

      const message = buildPushMessage(job);
      const results = await sender.sendToTokens(targets.map((d) => d.token), message);
      const byToken = new Map(results.map((r) => [r.token, r]));

      let accepted = 0;
      let retryable = 0;
      let lastError: string | null = null;
      for (const device of targets) {
        const r = byToken.get(device.token);
        let status: 'accepted' | 'retry' | 'invalid_token' | 'failed';
        if (r?.ok) {
          status = 'accepted';
          accepted += 1;
        } else {
          const cls = classifyPushError(r?.errorCode, r?.errorMessage);
          status = cls === 'invalid_token' ? 'invalid_token' : cls === 'retry' ? 'retry' : 'failed';
          lastError = r?.errorCode || 'send_failed';
          if (status === 'retry') retryable += 1;
          if (status === 'invalid_token') {
            await revokeDeviceById(device.id, 'fcm_unregistered');
            summary.invalidTokens += 1;
          }
        }
        await query(
          `INSERT INTO push_deliveries (job_id, device_id, token_hash, status, error_code, provider_message_id)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [job.id, device.id, device.token_hash, status, r?.errorCode?.slice(0, 80) ?? null, r?.messageId?.slice(0, 200) ?? null],
        );
      }
      summary.accepted += accepted;

      if (retryable > 0) {
        const again = await retryJob(job.id, job.attempts, lastError || 'retry', accepted);
        if (again) summary.retried += 1;
        else summary.failed += 1;
      } else if (accepted > 0 || done.size > 0) {
        await finishJob(job.id, 'sent', lastError, accepted);
        summary.sent += 1;
      } else {
        await finishJob(job.id, 'failed', lastError || 'send_failed', 0);
        summary.failed += 1;
      }
      log('job_done', {
        jobId: job.id,
        businessId: job.business_id,
        kind: job.kind,
        audience: job.audience,
        attempt: job.attempts,
        devices: targets.length,
        accepted,
        retryable,
        error: lastError,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log('job_error', { jobId: job.id, businessId: job.business_id, attempt: job.attempts, error: message });
      try {
        const again = await retryJob(job.id, job.attempts, message, 0);
        if (again) summary.retried += 1;
        else summary.failed += 1;
      } catch {
        /* the stale-lock expiry will surface the job again */
      }
    }
  }
  return summary;
}
