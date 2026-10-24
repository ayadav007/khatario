/**
 * Release 3 notification stream against real PostgreSQL (needs migrations 337/338): catch-up
 * scoping, the UNION ALL plan, the catch-up/live handshake race, out-of-order commits, resync
 * and re-fired reminders. Redis is replaced by calling hub.handleMessage directly.
 * Runs only when PHASE2_TEST_DATABASE_URL points at a disposable database.
 */
import { randomUUID } from 'crypto';
import type { Pool, PoolClient } from 'pg';

const url = process.env.PHASE2_TEST_DATABASE_URL;
if (url) process.env.DATABASE_URL = url;
const d = url ? describe : describe.skip;

jest.mock('@/lib/queue/redis', () => ({ getRedisConnection: () => null }));

import { getPool, closePool } from '@/lib/db';
import { withLedgerDelete } from '@/lib/accounting/ledger-delete-guard';
import { dbStreamSource, STREAM_SQL, type StreamSource } from '@/lib/notifications/stream/catch-up';
import { createNotificationStreamHub, type NotificationStreamHub } from '@/lib/notifications/stream/hub';
import { attachAndRead } from '../lib/notifications/stream/sse-harness';

type Tenant = { businessId: string; userId: string; otherUserId: string };

d('notification stream (real DB)', () => {
  jest.setTimeout(120000);

  let pool: Pool;
  const businesses: string[] = [];
  const hubs: NotificationStreamHub[] = [];
  let phoneN = 0;

  async function tenant(): Promise<Tenant> {
    const businessId = randomUUID();
    const userId = randomUUID();
    const otherUserId = randomUUID();
    businesses.push(businessId);
    await pool.query(
      `INSERT INTO businesses (id, name, gstin, state_code, gst_registration_type)
       VALUES ($1, $2, '27AAAPA1234A1Z5', '27', 'regular')`,
      [businessId, `Stream ${businessId.slice(0, 8)}`]
    );
    for (const id of [userId, otherUserId]) {
      phoneN += 1;
      await pool.query(`INSERT INTO users (id, business_id, name, phone, is_active) VALUES ($1, $2, $3, $4, true)`, [
        id,
        businessId,
        `Stream user ${id.slice(0, 6)}`,
        `6${Date.now().toString().slice(-7)}${String(phoneN).padStart(2, '0')}`,
      ]);
    }
    return { businessId, userId, otherUserId };
  }

  async function insert(
    db: Pool | PoolClient,
    businessId: string,
    userId: string | null,
    type = 'general'
  ): Promise<{ id: string; seq: string }> {
    const r = await db.query<{ id: string; seq: string }>(
      `INSERT INTO notifications (business_id, user_id, type, title, message)
       VALUES ($1, $2, $3, 'stream test', 'msg') RETURNING id, seq::text AS seq`,
      [businessId, userId, type]
    );
    return r.rows[0];
  }

  function makeHub(source: StreamSource = dbStreamSource) {
    const hub = createNotificationStreamHub({
      source,
      createSubscriber: () => null,
      publisherReady: () => true, // keep heartbeat polling out of these tests
      random: () => 0,
      installSignalHandlers: false,
    });
    hubs.push(hub);
    return hub;
  }

  function openStream(hub: NotificationStreamHub, t: Tenant, cursor: bigint | null) {
    const r = hub.open({
      scope: { businessId: t.businessId, userId: t.userId },
      initialCursor: cursor,
      authorize: async () => 'ok',
    });
    if (!r.ok) throw new Error('refused');
    return { conn: r.connection, sse: attachAndRead(r.connection) };
  }

  async function until(cond: () => boolean, ms = 5000) {
    const end = Date.now() + ms;
    while (!cond()) {
      if (Date.now() > end) throw new Error('timed out');
      await new Promise((r) => setTimeout(r, 20));
    }
  }

  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const hint = (hub: NotificationStreamHub, t: Tenant, id: string | null, userId: string | null = t.userId) =>
    hub.handleMessage(JSON.stringify({ businessId: t.businessId, userId, notificationId: id }));

  beforeAll(async () => {
    pool = getPool();
    const col = await pool.query(
      `SELECT 1 FROM information_schema.columns WHERE table_name = 'notifications' AND column_name = 'seq'`
    );
    if (col.rowCount === 0) throw new Error('notifications.seq missing: apply migrations 337/338 to the test database');
  });

  afterAll(async () => {
    if (!pool) return;
    try {
      await Promise.all(hubs.map((h) => h.shutdown()));
      await pool.query(`DELETE FROM notifications WHERE business_id = ANY($1::uuid[])`, [businesses]);
      const c = await pool.connect();
      try {
        await c.query('BEGIN');
        await withLedgerDelete(c, 'tenant_purge', null, async () => {
          await c.query(`DELETE FROM businesses WHERE id = ANY($1::uuid[])`, [businesses]);
        });
        await c.query('COMMIT');
      } catch (e) {
        await c.query('ROLLBACK').catch(() => {});
        throw e;
      } finally {
        c.release();
      }
    } finally {
      await closePool();
    }
  });

  it('catch-up queries return only own and business-wide rows of the session business', async () => {
    const t = await tenant();
    const other = await tenant();
    const own = await insert(pool, t.businessId, t.userId);
    const broadcast = await insert(pool, t.businessId, null);
    const colleague = await insert(pool, t.businessId, t.otherUserId);
    const foreign = await insert(pool, other.businessId, other.userId);
    const foreignBroadcast = await insert(pool, other.businessId, null);
    const scope = { businessId: t.businessId, userId: t.userId };

    const after = await dbStreamSource.fetchAfter(scope, 0n, 200);
    expect(after.map((r) => r.id).sort()).toEqual([own.id, broadcast.id].sort());
    expect(after.find((r) => r.id === own.id)).toMatchObject({ branch: 'own', seq: own.seq, recent: true });
    expect(after.find((r) => r.id === broadcast.id)).toMatchObject({ branch: 'broadcast', user_id: null });

    const byIds = await dbStreamSource.fetchByIds(scope, [own.id, broadcast.id, colleague.id, foreign.id, foreignBroadcast.id]);
    expect(byIds.map((r) => r.id).sort()).toEqual([own.id, broadcast.id].sort());

    const below = await dbStreamSource.fetchRecentAtOrBelow(scope, BigInt(foreignBroadcast.seq), 200);
    expect(below.map((r) => r.id).sort()).toEqual([own.id, broadcast.id].sort());

    expect(await dbStreamSource.latestSeq(scope)).toBe(BigInt(broadcast.seq));
    expect(await dbStreamSource.latestSeq({ businessId: t.businessId, userId: randomUUID() })).toBe(BigInt(broadcast.seq));
  });

  it('a live stream only delivers rows in its scope, even for mis-routed hints', async () => {
    const t = await tenant();
    const hub = makeHub();
    const { sse } = openStream(hub, t, null);
    await until(() => hub.size === 1 && sse.events().length > 0);
    await sleep(50);

    const colleague = await insert(pool, t.businessId, t.otherUserId);
    hint(hub, t, colleague.id); // wrongly addressed to our user
    const own = await insert(pool, t.businessId, t.userId);
    hint(hub, t, own.id);
    const broadcast = await insert(pool, t.businessId, null);
    hint(hub, t, broadcast.id, null);
    await until(() => sse.messages().length >= 2);
    await sleep(200);
    expect(sse.messages().map((e) => e.data.notificationId)).toEqual([own.id, broadcast.id]);
    expect(sse.messages().map((e) => e.id)).toEqual([own.seq, broadcast.seq]);
  });

  it('both UNION ALL branches use idx_notifications_business_user_seq', async () => {
    const t = await tenant();
    await pool.query(
      `INSERT INTO notifications (business_id, user_id, type, title, message)
       SELECT $1, CASE WHEN g % 3 = 0 THEN NULL ELSE $2::uuid END, 'general', 'plan', 'msg'
         FROM generate_series(1, 300) g`,
      [t.businessId, t.userId]
    );
    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      // Otherwise the planner may walk uq_notifications_seq in seq order on a small table.
      await c.query('DROP INDEX uq_notifications_seq');
      await c.query('ANALYZE notifications');
      await c.query('SET LOCAL enable_seqscan = off');
      const plan = await c.query<{ 'QUERY PLAN': string }>(`EXPLAIN ${STREAM_SQL.AFTER_SQL}`, [
        t.businessId,
        t.userId,
        '0',
        200,
        120,
      ]);
      const text = plan.rows.map((r) => r['QUERY PLAN']).join('\n');
      expect(text.match(/idx_notifications_business_user_seq/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
      expect(text).not.toMatch(/Seq Scan/);
    } finally {
      await c.query('ROLLBACK').catch(() => {});
      c.release();
    }
  });

  it('delivers a row inserted during catch-up exactly once, in order', async () => {
    const t = await tenant();
    const first = await insert(pool, t.businessId, t.userId);
    const cursor = BigInt(first.seq) - 1n;
    const second = await insert(pool, t.businessId, t.userId);

    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let paused = false;
    const source: StreamSource = {
      ...dbStreamSource,
      async fetchAfter(scope, after, limit) {
        const rows = await dbStreamSource.fetchAfter(scope, after, limit);
        if (!paused) {
          paused = true;
          await gate;
        }
        return rows;
      },
    };
    const hub = makeHub(source);
    const { conn, sse } = openStream(hub, t, cursor);
    await until(() => paused);

    const late = await insert(pool, t.businessId, t.userId);
    hint(hub, t, late.id);
    expect(conn.phase).toBe('catching_up');
    release();

    await until(() => sse.messages().length >= 3);
    await sleep(200);
    expect(sse.messages().map((e) => e.data.seq)).toEqual([first.seq, second.seq, late.seq]);
    expect(conn.phase).toBe('live');
  });

  it('delivers a lower seq committed after a higher one (hinted and unhinted)', async () => {
    const t = await tenant();
    const hub = makeHub();
    const { sse } = openStream(hub, t, null);
    await until(() => sse.events().length > 0);
    await sleep(50);

    const slowA = await pool.connect();
    const slowB = await pool.connect();
    try {
      await slowA.query('BEGIN');
      await slowB.query('BEGIN');
      const a = await insert(slowA, t.businessId, t.userId); // seq allocated now, not visible
      const b = await insert(slowB, t.businessId, t.userId);
      const fast = await insert(pool, t.businessId, t.userId);
      expect(BigInt(a.seq)).toBeLessThan(BigInt(fast.seq));
      hint(hub, t, fast.id);
      await until(() => sse.messages().length === 1);

      await slowA.query('COMMIT');
      hint(hub, t, a.id); // hinted late commit
      await until(() => sse.messages().length === 2);

      await slowB.query('COMMIT'); // never hinted: found by the overlap window on the next pull
      const next = await insert(pool, t.businessId, t.userId);
      hint(hub, t, next.id);
      await until(() => sse.messages().length === 4);
      await sleep(200);

      const msgs = sse.messages();
      expect(msgs.map((e) => e.data.seq)).toEqual([fast.seq, a.seq, b.seq, next.seq]);
      expect(msgs.map((e) => e.id)).toEqual([fast.seq, fast.seq, fast.seq, next.seq]);
    } finally {
      await slowA.query('ROLLBACK').catch(() => {});
      await slowB.query('ROLLBACK').catch(() => {});
      slowA.release();
      slowB.release();
    }
  });

  it('sends resync instead of replaying more than the catch-up bound', async () => {
    const t = await tenant();
    const before = await insert(pool, t.businessId, t.userId);
    await pool.query(
      `INSERT INTO notifications (business_id, user_id, type, title, message, created_at)
       SELECT $1, $2, 'general', 'bulk', 'msg', LOCALTIMESTAMP - interval '1 hour' FROM generate_series(1, 1101)`,
      [t.businessId, t.userId]
    );
    const latest = await dbStreamSource.latestSeq({ businessId: t.businessId, userId: t.userId });
    const hub = makeHub();
    const { conn, sse } = openStream(hub, t, BigInt(before.seq));
    await until(() => sse.events().some((e) => e.event === 'resync'), 20000);
    expect(sse.events().find((e) => e.event === 'resync')).toMatchObject({
      id: latest.toString(),
      data: { reason: 'too_many', latest_seq: latest.toString() },
    });
    expect(conn.currentCursor).toBe(latest);
  });

  it('re-fired reminders get a new seq and are streamed again', async () => {
    const t = await tenant();
    const hub = makeHub();
    const { sse } = openStream(hub, t, null);
    await until(() => sse.events().length > 0);
    await sleep(50);

    const reminder = await insert(pool, t.businessId, t.userId, 'todo_reminder');
    hint(hub, t, reminder.id);
    await until(() => sse.messages().length === 1);

    const refired = await pool.query<{ seq: string }>(
      `UPDATE notifications SET created_at = created_at + interval '1 second' WHERE id = $1 RETURNING seq::text AS seq`,
      [reminder.id]
    );
    expect(BigInt(refired.rows[0].seq)).toBeGreaterThan(BigInt(reminder.seq));
    hint(hub, t, reminder.id);
    await until(() => sse.messages().length === 2);
    expect(sse.messages().map((e) => [e.data.notificationId, e.data.seq, e.data.type])).toEqual([
      [reminder.id, reminder.seq, 'todo_reminder'],
      [reminder.id, refired.rows[0].seq, 'todo_reminder'],
    ]);
  });
});
