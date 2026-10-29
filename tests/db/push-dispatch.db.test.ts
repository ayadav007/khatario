/**
 * Push outbox against real PostgreSQL (needs migration 445): the trigger, audience isolation
 * (business users vs store customers, one business vs another, one user vs the whole business),
 * stale sessions, invalid tokens, retries without re-sending, concurrent workers and re-fires.
 * FCM is replaced by an in-memory sender. Runs only when PHASE2_TEST_DATABASE_URL points at a
 * disposable database.
 */
import { randomUUID } from 'crypto';
import type { Pool } from 'pg';

const url = process.env.PHASE2_TEST_DATABASE_URL;
if (url) process.env.DATABASE_URL = url;
const d = url ? describe : describe.skip;

import { getPool, closePool } from '@/lib/db';
import { registerPushDevice, revokePushDevice } from '@/lib/push/device-registry';
import { dispatchPushJobs } from '@/lib/push/dispatcher';
import { enqueueCustomerPush } from '@/lib/push/customer-push';
import { tokenHash } from '@/lib/push/fcm';
import type { PushMessage, PushSender, PushSendResult } from '@/lib/push/types';

class FakeSender implements PushSender {
  calls: { tokens: string[]; message: PushMessage }[] = [];
  /** token → error code for the next send */
  fail = new Map<string, string>();
  delayMs = 0;
  async sendToTokens(tokens: string[], message: PushMessage): Promise<PushSendResult[]> {
    this.calls.push({ tokens: [...tokens], message });
    if (this.delayMs) await new Promise((r) => setTimeout(r, this.delayMs));
    return tokens.map((token) => {
      const code = this.fail.get(token);
      return code ? { token, ok: false, errorCode: code } : { token, ok: true, messageId: `projects/x/messages/${token.slice(-6)}` };
    });
  }
  sentTokens(): string[] {
    return this.calls.flatMap((c) => c.tokens);
  }
}

const quiet = () => undefined;

d('push outbox (real DB)', () => {
  jest.setTimeout(120000);
  let pool: Pool;
  const businesses: string[] = [];
  let phoneN = 0;
  const nextPhone = () => `6${Date.now().toString().slice(-7)}${String(++phoneN).padStart(2, '0')}`;
  const tok = (name: string) => `fcm-${name}-${randomUUID()}`;

  async function business(name: string) {
    const id = randomUUID();
    businesses.push(id);
    await pool.query(
      `INSERT INTO businesses (id, name, gstin, state_code, gst_registration_type) VALUES ($1, $2, '27AAAPA1234A1Z5', '27', 'regular')`,
      [id, `Push ${name} ${id.slice(0, 6)}`],
    );
    return id;
  }
  async function user(businessId: string, name: string, extraBusiness?: string) {
    const id = randomUUID();
    await pool.query(`INSERT INTO users (id, business_id, name, phone, is_active) VALUES ($1, $2, $3, $4, true)`, [id, businessId, name, nextPhone()]);
    if (extraBusiness) {
      await pool.query(`INSERT INTO user_businesses (user_id, business_id, role) VALUES ($1, $2, 'staff')`, [id, extraBusiness]);
    }
    return id;
  }
  async function customer(businessId: string, phone: string) {
    const id = randomUUID();
    await pool.query(`INSERT INTO store_customers (id, business_id, phone, name) VALUES ($1, $2, $3, 'Push customer')`, [id, businessId, phone]);
    return id;
  }
  async function notification(businessId: string, userId: string | null, type = 'general') {
    const r = await pool.query<{ id: string; seq: string }>(
      `INSERT INTO notifications (business_id, user_id, type, title, message, reference_type, reference_id)
       VALUES ($1, $2, $3, 'Push test', 'hello', 'supply_order', $4) RETURNING id, seq::text AS seq`,
      [businessId, userId, type, randomUUID()],
    );
    return r.rows[0];
  }
  async function jobsFor(notificationId: string) {
    return (await pool.query(`SELECT * FROM push_jobs WHERE notification_id = $1 ORDER BY created_at`, [notificationId])).rows;
  }
  async function deliveries(jobId: string) {
    return (await pool.query(`SELECT device_id, token_hash, status, error_code FROM push_deliveries WHERE job_id = $1 ORDER BY id`, [jobId])).rows;
  }
  async function device(id: string) {
    return (await pool.query(`SELECT revoked_at, revoked_reason, user_id, customer_id FROM push_devices WHERE id = $1`, [id])).rows[0];
  }

  beforeAll(async () => {
    pool = getPool();
    const info = (await pool.query(`SELECT current_database() AS db`)).rows[0];
    if (info.db !== 'kh_phase2_test') throw new Error(`refusing to run on ${info.db}`);
    // Leftover pending jobs from other tests would be claimed by our dispatches; park them.
    await pool.query(`UPDATE push_jobs SET status = 'skipped', last_error = 'parked_by_test' WHERE status = 'pending'`);
  });

  afterAll(async () => {
    if (businesses.length) {
      await pool.query(`DELETE FROM push_devices WHERE business_id = ANY($1::uuid[]) OR user_id IN (SELECT id FROM users WHERE business_id = ANY($1::uuid[]))`, [businesses]);
      await pool.query(`DELETE FROM notifications WHERE business_id = ANY($1::uuid[])`, [businesses]);
      await pool.query(`DELETE FROM push_jobs WHERE business_id = ANY($1::uuid[])`, [businesses]);
      await pool.query(`DELETE FROM store_customers WHERE business_id = ANY($1::uuid[])`, [businesses]);
      await pool.query(`DELETE FROM user_businesses WHERE business_id = ANY($1::uuid[])`, [businesses]);
      await pool.query(`DELETE FROM users WHERE business_id = ANY($1::uuid[])`, [businesses]);
      await pool.query(`DELETE FROM businesses WHERE id = ANY($1::uuid[])`, [businesses]);
    }
    await closePool();
  });

  it('a notification row becomes one push job for its business audience, by trigger', async () => {
    const biz = await business('trigger');
    const n = await notification(biz, null);
    const jobs = await jobsFor(n.id);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({ kind: 'notification', audience: 'business', business_id: biz, user_id: null, status: 'pending', title: 'Push test', body: 'hello' });
    expect(jobs[0].data).toMatchObject({ type: 'general', reference_type: 'supply_order' });
    expect(String(jobs[0].notification_seq)).toBe(n.seq);
    // Consume it (no devices → skipped) so later counts in this file are their own.
    await dispatchPushJobs({ sender: new FakeSender(), log: quiet, limit: 10 });
    expect((await jobsFor(n.id))[0]).toMatchObject({ status: 'skipped', last_error: 'no_devices' });
  });

  it('broadcasts reach every member device of that business and nothing else', async () => {
    const bizA = await business('A');
    const bizB = await business('B');
    const a1 = await user(bizA, 'a1');
    const a2 = await user(bizB, 'a2 member of A via user_businesses', bizA);
    const b1 = await user(bizB, 'b1');
    const custPhone = nextPhone();
    const c1 = await customer(bizA, custPhone);

    const tA1x = tok('a1x');
    const tA1y = tok('a1y');
    const tA2 = tok('a2');
    const tB1 = tok('b1');
    const tC1 = tok('c1');
    for (const [userId, token] of [[a1, tA1x], [a1, tA1y], [a2, tA2], [b1, tB1]] as const) {
      const r = await registerPushDevice({ audience: 'business', userId, appId: 'com.khatario.phone', token });
      expect(r.ok).toBe(true);
    }
    const rc = await registerPushDevice({ audience: 'customer', customerId: c1, businessId: bizA, appId: 'com.khatario.app', token: tC1 });
    expect(rc.ok).toBe(true);

    const sender = new FakeSender();
    const n = await notification(bizA, null);
    const summary = await dispatchPushJobs({ sender, log: quiet, limit: 10 });
    expect(summary.claimed).toBe(1);
    expect(summary.sent).toBe(1);
    expect(sender.sentTokens().sort()).toEqual([tA1x, tA1y, tA2].sort());
    expect(sender.sentTokens()).not.toContain(tB1);
    expect(sender.sentTokens()).not.toContain(tC1);
    expect(sender.calls[0].message.data).toMatchObject({ business_id: bizA, notification_id: n.id, audience: 'business' });

    const [job] = await jobsFor(n.id);
    expect(job.status).toBe('sent');
    expect(job.sent_count).toBe(3);
    const rows = await deliveries(job.id);
    expect(rows).toHaveLength(3);
    expect(rows.every((r) => r.status === 'accepted')).toBe(true);
    // Delivery rows carry the hash, never the token.
    expect(rows.map((r) => r.token_hash).sort()).toEqual([tokenHash(tA1x), tokenHash(tA1y), tokenHash(tA2)].sort());

    // A per-user row goes to that user's devices only.
    sender.calls = [];
    const own = await notification(bizA, a1, 'todo_reminder');
    await dispatchPushJobs({ sender, log: quiet, limit: 10 });
    expect(sender.sentTokens().sort()).toEqual([tA1x, tA1y].sort());
    expect((await jobsFor(own.id))[0].status).toBe('sent');

    // A customer message reaches the customer's device for this shop only.
    sender.calls = [];
    const q = await enqueueCustomerPush({ businessId: bizA, phone: `+91${custPhone}`, eventKey: 'order_delivered', body: 'Your order is delivered' });
    expect(q.queued).toBe(true);
    const wrongShop = await enqueueCustomerPush({ businessId: bizB, phone: custPhone, eventKey: 'order_delivered', body: 'x' });
    expect(wrongShop).toEqual({ queued: false, reason: 'no_device' });
    const merchantEvent = await enqueueCustomerPush({ businessId: bizA, phone: custPhone, eventKey: 'merchant_new_order', body: 'x' });
    expect(merchantEvent).toEqual({ queued: false, reason: 'not_customer_event' });
    await dispatchPushJobs({ sender, log: quiet, limit: 10 });
    expect(sender.sentTokens()).toEqual([tC1]);
    expect(sender.calls[0].message.data).toMatchObject({ audience: 'customer', href: '/account', business_id: bizA });
    expect(sender.calls[0].message.notification.title).toBe('Order delivered');

    // Logout revokes only the owner's token; another user cannot revoke it.
    expect(await revokePushDevice(tA1x, { audience: 'business', userId: b1 })).toBe(false);
    expect(await revokePushDevice(tA1x, { audience: 'business', userId: a1 })).toBe(true);
    sender.calls = [];
    await notification(bizA, null);
    await dispatchPushJobs({ sender, log: quiet, limit: 10 });
    expect(sender.sentTokens().sort()).toEqual([tA1y, tA2].sort());
  });

  it('skips a business with no devices, revokes stale sessions and dead tokens', async () => {
    const biz = await business('stale');
    const u = await user(biz, 'u');
    const empty = await notification(biz, null);
    const sender = new FakeSender();
    const s0 = await dispatchPushJobs({ sender, log: quiet, limit: 10 });
    expect(s0.skipped).toBe(1);
    expect((await jobsFor(empty.id))[0]).toMatchObject({ status: 'skipped', last_error: 'no_devices' });

    const alive = tok('alive');
    const dead = tok('dead');
    const r1 = await registerPushDevice({ audience: 'business', userId: u, appId: 'com.khatario.phone', token: alive });
    const r2 = await registerPushDevice({ audience: 'business', userId: u, appId: 'com.khatario.phone', token: dead });
    if (!r1.ok || !r2.ok) throw new Error('register failed');
    sender.fail.set(dead, 'messaging/registration-token-not-registered');
    const n = await notification(biz, null);
    const s1 = await dispatchPushJobs({ sender, log: quiet, limit: 10 });
    expect(s1.invalidTokens).toBe(1);
    expect(s1.sent).toBe(1);
    expect(await device(r2.deviceId)).toMatchObject({ revoked_reason: 'fcm_unregistered' });
    expect((await device(r1.deviceId)).revoked_at).toBeNull();
    const rows = await deliveries((await jobsFor(n.id))[0].id);
    expect(rows.map((r) => r.status).sort()).toEqual(['accepted', 'invalid_token']);

    // The user signs out elsewhere (session version bump): the device stops receiving.
    await pool.query(`UPDATE users SET auth_session_version = auth_session_version + 1 WHERE id = $1`, [u]);
    sender.calls = [];
    const after = await notification(biz, null);
    await dispatchPushJobs({ sender, log: quiet, limit: 10 });
    expect(sender.calls).toHaveLength(0);
    expect(await device(r1.deviceId)).toMatchObject({ revoked_reason: 'session_ended' });
    expect((await jobsFor(after.id))[0].status).toBe('skipped');

    // Signing in again re-registers the same token with the new version.
    const r3 = await registerPushDevice({ audience: 'business', userId: u, appId: 'com.khatario.phone', token: alive });
    expect(r3.ok && r3.deviceId).toBe(r1.deviceId);
    expect((await device(r1.deviceId)).revoked_at).toBeNull();
  });

  it('retries transient errors with backoff and never re-sends to a device that accepted', async () => {
    const biz = await business('retry');
    const u = await user(biz, 'u');
    const good = tok('good');
    const flaky = tok('flaky');
    await registerPushDevice({ audience: 'business', userId: u, appId: 'com.khatario.phone', token: good });
    await registerPushDevice({ audience: 'business', userId: u, appId: 'com.khatario.phone', token: flaky });
    const sender = new FakeSender();
    sender.fail.set(flaky, 'messaging/server-unavailable');
    const n = await notification(biz, null);
    const s1 = await dispatchPushJobs({ sender, log: quiet, limit: 10 });
    expect(s1.retried).toBe(1);
    let [job] = await jobsFor(n.id);
    expect(job.status).toBe('pending');
    expect(job.attempts).toBe(1);
    expect(job.last_error).toBe('messaging/server-unavailable');
    expect(new Date(job.next_attempt_at).getTime()).toBeGreaterThan(Date.now() + 20_000);

    // Not due yet: nothing is claimed.
    const s2 = await dispatchPushJobs({ sender, log: quiet, limit: 10 });
    expect(s2.claimed).toBe(0);

    await pool.query(`UPDATE push_jobs SET next_attempt_at = CURRENT_TIMESTAMP WHERE id = $1`, [job.id]);
    sender.fail.clear();
    sender.calls = [];
    const s3 = await dispatchPushJobs({ sender, log: quiet, limit: 10 });
    expect(s3.sent).toBe(1);
    expect(sender.sentTokens()).toEqual([flaky]);
    [job] = await jobsFor(n.id);
    expect(job).toMatchObject({ status: 'sent', attempts: 2, sent_count: 2 });
    const rows = await deliveries(job.id);
    expect(rows.map((r) => r.status)).toEqual(['accepted', 'retry', 'accepted']);
  });

  it('gives up after the last retry', async () => {
    const biz = await business('giveup');
    const u = await user(biz, 'u');
    const t = tok('down');
    await registerPushDevice({ audience: 'business', userId: u, appId: 'com.khatario.phone', token: t });
    const sender = new FakeSender();
    sender.fail.set(t, 'messaging/internal-error');
    const n = await notification(biz, null);
    for (let i = 0; i < 5; i++) {
      await pool.query(`UPDATE push_jobs SET next_attempt_at = CURRENT_TIMESTAMP WHERE notification_id = $1`, [n.id]);
      await dispatchPushJobs({ sender, log: quiet, limit: 10 });
    }
    const [job] = await jobsFor(n.id);
    expect(job.status).toBe('failed');
    expect(job.attempts).toBe(5);
    expect(job.last_error).toMatch(/gave up after 5 attempts/);
    expect(sender.calls).toHaveLength(5);
  });

  it('two workers claim disjoint jobs and each job is sent exactly once', async () => {
    const biz = await business('workers');
    const u = await user(biz, 'u');
    const t = tok('one');
    await registerPushDevice({ audience: 'business', userId: u, appId: 'com.khatario.phone', token: t });
    const ids: string[] = [];
    for (let i = 0; i < 8; i++) ids.push((await notification(biz, null)).id);
    const s1 = new FakeSender();
    const s2 = new FakeSender();
    s1.delayMs = 30;
    s2.delayMs = 30;
    const [r1, r2] = await Promise.all([
      dispatchPushJobs({ sender: s1, log: quiet, limit: 4 }),
      dispatchPushJobs({ sender: s2, log: quiet, limit: 4 }),
    ]);
    expect(r1.claimed + r2.claimed).toBe(8);
    const sent = (await pool.query(`SELECT notification_id, status, sent_count FROM push_jobs WHERE notification_id = ANY($1::uuid[])`, [ids])).rows;
    expect(sent.every((j) => j.status === 'sent' && j.sent_count === 1)).toBe(true);
    expect(s1.sentTokens().length + s2.sentTokens().length).toBe(8);
  });

  it('a re-fired todo reminder (new seq) gets a new job; a plain read update does not', async () => {
    const biz = await business('refire');
    const u = await user(biz, 'u');
    const n = await notification(biz, u, 'todo_reminder');
    await pool.query(`UPDATE notifications SET is_read = true, read_at = NOW() WHERE id = $1`, [n.id]);
    expect(await jobsFor(n.id)).toHaveLength(1);
    await pool.query(`UPDATE notifications SET created_at = NOW() + INTERVAL '1 second', is_read = false WHERE id = $1`, [n.id]);
    const jobs = await jobsFor(n.id);
    expect(jobs).toHaveLength(2);
    expect(String(jobs[1].notification_seq)).not.toBe(String(jobs[0].notification_seq));
  });

  it('the job is failed, not lost, when FCM is not configured', async () => {
    const biz = await business('nofcm');
    const u = await user(biz, 'u');
    await registerPushDevice({ audience: 'business', userId: u, appId: 'com.khatario.phone', token: tok('x') });
    const n = await notification(biz, null);
    const s = await dispatchPushJobs({ sender: null, log: quiet, limit: 10 });
    expect(s.failed).toBe(1);
    const [job] = await jobsFor(n.id);
    expect(job.status).toBe('failed');
    expect(job.last_error).toBe('fcm_not_configured');
    // The in-app row is untouched.
    const row = (await pool.query(`SELECT is_read FROM notifications WHERE id = $1`, [n.id])).rows[0];
    expect(row.is_read).toBe(false);
  });
});
