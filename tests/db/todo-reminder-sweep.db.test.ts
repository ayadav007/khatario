/**
 * Real-PostgreSQL tests for the todo reminder DB sweep (the worker's safety net when BullMQ jobs
 * are missing). Runs only when PHASE2_TEST_DATABASE_URL points at a disposable database.
 * Redis and WhatsApp are stubbed; delivery writes real `notifications` rows.
 */
import { randomUUID } from 'crypto';
import type { Pool, PoolClient } from 'pg';

const url = process.env.PHASE2_TEST_DATABASE_URL;
if (url) process.env.DATABASE_URL = url;
const d = url ? describe : describe.skip;

const expiredBusinesses = new Set<string>();

jest.mock('@/lib/queue/redis', () => ({ getRedisConnection: () => null }));
jest.mock('@/lib/whatsapp', () => ({
  sendWhatsAppMessage: jest.fn(),
  getWhatsAppStatus: jest.fn().mockResolvedValue({ status: 'disconnected' }),
}));
jest.mock('@/lib/subscription', () => ({
  getBusinessSubscription: jest.fn(async (businessId: string) =>
    expiredBusinesses.has(businessId)
      ? { status: 'expired', end_date: '2020-01-01' }
      : { status: 'active', end_date: null }
  ),
  isSubscriptionOperationalStatus: (s: string) => s === 'active' || s === 'trial',
  hasFeature: jest.fn().mockResolvedValue(false),
}));

import { getPool, closePool } from '@/lib/db';
import { withLedgerDelete } from '@/lib/accounting/ledger-delete-guard';
import { sweepDueTodoReminders } from '@/lib/todo-reminders/sweepDueTodoReminders';

d('todo reminder sweep (real DB)', () => {
  jest.setTimeout(60000);

  let pool: Pool;
  const BIZ = randomUUID();
  const BIZ_EXPIRED = randomUUID();
  const CREATOR = randomUUID();
  const ASSIGNEE = randomUUID();
  const OTHER = randomUUID();
  const tag = BIZ.slice(0, 8);

  async function tx<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      const r = await fn(c);
      await c.query('COMMIT');
      return r;
    } catch (e) {
      await c.query('ROLLBACK').catch(() => {});
      throw e;
    } finally {
      c.release();
    }
  }

  async function addTodo(opts: {
    business?: string;
    assignedTo?: string | null;
    reminderOffsetSec: number;
    status?: string;
    reminderSent?: boolean;
  }): Promise<string> {
    const r = await pool.query<{ id: string }>(
      `INSERT INTO todos (business_id, assigned_to, created_by, title, due_date, reminder_type,
                          reminder_time, reminder_channels, status, reminder_sent)
       VALUES ($1, $2, $3, $4, NOW(), 'once', NOW() + make_interval(secs => $5), ARRAY['in_app'],
               $6::todo_status, $7)
       RETURNING id`,
      [
        opts.business ?? BIZ,
        opts.assignedTo === undefined ? ASSIGNEE : opts.assignedTo,
        CREATOR,
        `sweep-${tag}-${randomUUID().slice(0, 6)}`,
        opts.reminderOffsetSec,
        opts.status ?? 'pending',
        opts.reminderSent ?? false,
      ],
    );
    return r.rows[0].id;
  }

  async function recipients(todoId: string): Promise<string[]> {
    const r = await pool.query<{ user_id: string }>(
      `SELECT user_id FROM notifications WHERE type = 'todo_reminder' AND reference_id = $1 ORDER BY user_id`,
      [todoId],
    );
    return r.rows.map((x) => x.user_id);
  }

  async function sent(todoId: string): Promise<boolean> {
    const r = await pool.query<{ reminder_sent: boolean }>(`SELECT reminder_sent FROM todos WHERE id = $1`, [todoId]);
    return r.rows[0].reminder_sent;
  }

  beforeAll(async () => {
    pool = getPool();
    for (const biz of [BIZ, BIZ_EXPIRED]) {
      await pool.query(
        `INSERT INTO businesses (id, name, gstin, state_code, gst_registration_type)
         VALUES ($1, $2, '27AAAPA1234A1Z5', '27', 'regular')`,
        [biz, `Todo sweep ${tag} ${biz.slice(0, 4)}`],
      );
    }
    let n = 0;
    for (const [id, name] of [[CREATOR, 'Creator'], [ASSIGNEE, 'Assignee'], [OTHER, 'Other member']]) {
      n += 1;
      await pool.query(
        `INSERT INTO users (id, business_id, name, phone) VALUES ($1, $2, $3, $4)`,
        [id, BIZ, `${name} ${tag}`, `8${Date.now().toString().slice(-8)}${n}`],
      );
    }
    expiredBusinesses.add(BIZ_EXPIRED);
  });

  afterAll(async () => {
    if (!pool) return;
    try {
      await pool.query(`DELETE FROM notifications WHERE business_id = ANY($1::uuid[])`, [[BIZ, BIZ_EXPIRED]]);
      await pool.query(`DELETE FROM todos WHERE business_id = ANY($1::uuid[])`, [[BIZ, BIZ_EXPIRED]]);
      await tx(async (c) => {
        await withLedgerDelete(c, 'tenant_purge', null, async () => {
          await c.query(`DELETE FROM businesses WHERE id = ANY($1::uuid[])`, [[BIZ, BIZ_EXPIRED]]);
        });
      });
    } finally {
      await closePool();
    }
  });

  it('delivers a due reminder only to the assignee and the creator', async () => {
    const id = await addTodo({ reminderOffsetSec: -60 });
    await sweepDueTodoReminders();
    expect(await sent(id)).toBe(true);
    expect(await recipients(id)).toEqual([ASSIGNEE, CREATOR].sort());
    expect(await recipients(id)).not.toContain(OTHER);
  });

  it('notifies the creator once when the todo is unassigned', async () => {
    const id = await addTodo({ assignedTo: null, reminderOffsetSec: -30 });
    await sweepDueTodoReminders();
    expect(await recipients(id)).toEqual([CREATOR]);
  });

  it('leaves future, completed and already-sent reminders alone', async () => {
    const future = await addTodo({ reminderOffsetSec: 3600 });
    const completed = await addTodo({ reminderOffsetSec: -60, status: 'completed' });
    const already = await addTodo({ reminderOffsetSec: -60, reminderSent: true });
    await sweepDueTodoReminders();
    expect(await sent(future)).toBe(false);
    expect(await recipients(future)).toEqual([]);
    expect(await recipients(completed)).toEqual([]);
    expect(await recipients(already)).toEqual([]);
  });

  it('re-delivers a snoozed reminder once it is due again, without duplicate rows', async () => {
    const id = await addTodo({ reminderOffsetSec: -60 });
    await sweepDueTodoReminders();
    await pool.query(`UPDATE notifications SET is_read = true WHERE reference_id = $1`, [id]);

    await pool.query(
      `UPDATE todos SET reminder_time = NOW() + interval '1 hour', reminder_sent = false WHERE id = $1`,
      [id],
    );
    await sweepDueTodoReminders();
    expect(await sent(id)).toBe(false);

    await pool.query(`UPDATE todos SET reminder_time = NOW() - interval '1 second' WHERE id = $1`, [id]);
    await sweepDueTodoReminders();
    expect(await sent(id)).toBe(true);
    const rows = await pool.query<{ is_read: boolean }>(
      `SELECT is_read FROM notifications WHERE type = 'todo_reminder' AND reference_id = $1`,
      [id],
    );
    expect(rows.rows).toHaveLength(2);
    expect(rows.rows.every((r) => r.is_read === false)).toBe(true);
  });

  it('delivers each reminder once when two sweeps overlap', async () => {
    const ids = await Promise.all([1, 2, 3, 4, 5].map(() => addTodo({ reminderOffsetSec: -10 })));
    await Promise.all([sweepDueTodoReminders(), sweepDueTodoReminders()]);
    for (const id of ids) {
      expect(await recipients(id)).toEqual([ASSIGNEE, CREATOR].sort());
    }
    const history = await pool.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM todo_history WHERE todo_id = ANY($1::uuid[]) AND action = 'reminder_sent'`,
      [ids],
    );
    expect(Number(history.rows[0].n)).toBe(ids.length);
  });

  it('does not spin on reminders it has to skip', async () => {
    await Promise.all(
      [1, 2, 3].map(() => addTodo({ business: BIZ_EXPIRED, assignedTo: null, reminderOffsetSec: -60 })),
    );
    const started = Date.now();
    const r = await sweepDueTodoReminders({ batchSize: 2, maxWallMs: 20_000 });
    expect(r.stoppedReason).toBe('complete');
    expect(Date.now() - started).toBeLessThan(10_000);
  });
});
