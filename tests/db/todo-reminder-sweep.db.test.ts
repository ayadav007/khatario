/**
 * Real-PostgreSQL tests for todo reminder delivery: the shared DB sweep (worker safety net and
 * both cron routes), the claim, failure handling and concurrency. Runs only when
 * PHASE2_TEST_DATABASE_URL points at a disposable database (with migrations 337/338).
 * Redis and WhatsApp are stubbed; delivery writes real `notifications` rows. Insert failures are
 * injected with a test-only trigger on notifications (dropped in afterAll).
 */
import { randomUUID } from 'crypto';
import type { Pool, PoolClient } from 'pg';
import { NextRequest } from 'next/server';

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
import {
  sweepDueTodoReminders,
  resetSweepPositionsForTests,
} from '@/lib/todo-reminders/sweepDueTodoReminders';
import { triggerTodoReminder, type TodoForReminder } from '@/lib/services/todoReminderService';
import { processTodoReminderJob } from '@/lib/todo-reminders/processReminderJob';
import { GET as checkRemindersGET } from '@/app/api/todos/check-reminders/route';
import { GET as sendTodoRemindersGET } from '@/app/api/cron/send-todo-reminders/route';

d('todo reminder delivery (real DB)', () => {
  jest.setTimeout(90000);

  let pool: Pool;
  const BIZ = randomUUID();
  const BIZ_EXPIRED = randomUUID();
  const CREATOR = randomUUID();
  const ASSIGNEE = randomUUID();
  const OTHER = randomUUID();
  const FAULT_A = randomUUID();
  const FAULT_B = randomUUID();
  const tag = BIZ.slice(0, 8);
  const SECRET = 'r5-test-cron-secret';

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
    createdBy?: string | null;
    reminderOffsetSec: number;
    status?: string;
    reminderSent?: boolean;
    title?: string;
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
        opts.createdBy === undefined ? CREATOR : opts.createdBy,
        opts.title ?? `sweep-${tag}-${randomUUID().slice(0, 6)}`,
        opts.reminderOffsetSec,
        opts.status ?? 'pending',
        opts.reminderSent ?? false,
      ],
    );
    return r.rows[0].id;
  }

  const row = async (id: string) =>
    (await pool.query<TodoForReminder>(`SELECT * FROM todos WHERE id = $1`, [id])).rows[0];

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

  async function historyCount(ids: string[]): Promise<number> {
    const r = await pool.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM todo_history WHERE todo_id = ANY($1::uuid[]) AND action = 'reminder_sent'`,
      [ids],
    );
    return Number(r.rows[0].n);
  }

  async function fault(userId: string, kind: 'transient' | 'deleted_recipient' | 'other_fk') {
    await pool.query(`INSERT INTO r5_reminder_faults (user_id, kind) VALUES ($1, $2)`, [userId, kind]);
  }

  /** Clock for sweep budgets: each reading advances one unit. */
  const ticking = () => {
    let t = 0;
    return () => t++;
  };

  beforeAll(async () => {
    pool = getPool();
    for (const [biz, status] of [
      [BIZ, 'active'],
      [BIZ_EXPIRED, 'expired'],
    ]) {
      await pool.query(
        `INSERT INTO businesses (id, name, gstin, state_code, gst_registration_type)
         VALUES ($1, $2, '27AAAPA1234A1Z5', '27', 'regular')`,
        [biz, `Todo sweep ${tag} ${biz.slice(0, 4)}`],
      );
      await pool.query(
        `INSERT INTO business_module_subscriptions (business_id, module_key, plan_id, status, start_date, end_date)
         VALUES ($1, 'billing', 'professional', $2, CURRENT_DATE - 30, $3)`,
        [biz, status, status === 'active' ? null : '2020-01-01'],
      );
    }
    let n = 0;
    for (const [id, name] of [
      [CREATOR, 'Creator'],
      [ASSIGNEE, 'Assignee'],
      [OTHER, 'Other member'],
      [FAULT_A, 'Fault A'],
      [FAULT_B, 'Fault B'],
    ]) {
      n += 1;
      await pool.query(
        `INSERT INTO users (id, business_id, name, phone) VALUES ($1, $2, $3, $4)`,
        [id, BIZ, `${name} ${tag}`, `8${Date.now().toString().slice(-8)}${n}`],
      );
    }
    expiredBusinesses.add(BIZ_EXPIRED);

    await pool.query(`CREATE TABLE IF NOT EXISTS r5_reminder_faults (user_id uuid PRIMARY KEY, kind text NOT NULL)`);
    await pool.query(`
      CREATE OR REPLACE FUNCTION r5_reminder_fault() RETURNS trigger LANGUAGE plpgsql AS $$
      DECLARE k text;
      BEGIN
        SELECT kind INTO k FROM r5_reminder_faults WHERE user_id = NEW.user_id;
        IF k = 'transient' THEN
          RAISE EXCEPTION 'injected transient failure' USING ERRCODE = 'deadlock_detected';
        ELSIF k = 'deleted_recipient' THEN
          RAISE EXCEPTION 'injected recipient fk' USING ERRCODE = 'foreign_key_violation',
            CONSTRAINT = 'notifications_user_id_fkey', TABLE = 'notifications';
        ELSIF k = 'other_fk' THEN
          RAISE EXCEPTION 'injected unrelated fk' USING ERRCODE = 'foreign_key_violation',
            CONSTRAINT = 'notifications_business_id_fkey', TABLE = 'notifications';
        END IF;
        RETURN NEW;
      END $$`);
    await pool.query(`DROP TRIGGER IF EXISTS r5_reminder_fault ON notifications`);
    await pool.query(
      `CREATE TRIGGER r5_reminder_fault BEFORE INSERT OR UPDATE ON notifications
         FOR EACH ROW EXECUTE FUNCTION r5_reminder_fault()`,
    );
  });

  beforeEach(() => resetSweepPositionsForTests());

  afterEach(async () => {
    await pool.query(`DELETE FROM r5_reminder_faults`);
    // Leftover due rows (deliberately failing or skipped) must not leak into later tests.
    await pool.query(
      `UPDATE todos SET status = 'completed' WHERE business_id = ANY($1::uuid[]) AND reminder_sent = false`,
      [[BIZ, BIZ_EXPIRED]],
    );
  });

  afterAll(async () => {
    if (!pool) return;
    try {
      await pool.query(`DROP TRIGGER IF EXISTS r5_reminder_fault ON notifications`);
      await pool.query(`DROP FUNCTION IF EXISTS r5_reminder_fault()`);
      await pool.query(`DROP TABLE IF EXISTS r5_reminder_faults`);
      await pool.query(`DELETE FROM notifications WHERE business_id = ANY($1::uuid[])`, [[BIZ, BIZ_EXPIRED]]);
      await pool.query(`DELETE FROM todos WHERE business_id = ANY($1::uuid[])`, [[BIZ, BIZ_EXPIRED]]);
      await pool.query(`DELETE FROM business_module_subscriptions WHERE business_id = ANY($1::uuid[])`, [[BIZ, BIZ_EXPIRED]]);
      await tx(async (c) => {
        await withLedgerDelete(c, 'tenant_purge', null, async () => {
          await c.query(`DELETE FROM businesses WHERE id = ANY($1::uuid[])`, [[BIZ, BIZ_EXPIRED]]);
        });
      });
    } finally {
      delete process.env.CRON_SECRET;
      await closePool();
    }
  });

  describe('delivery basics', () => {
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

    it('re-fires a snoozed reminder with a new seq and cleared dismissal, one row per recipient', async () => {
      const id = await addTodo({ reminderOffsetSec: -60 });
      await sweepDueTodoReminders();
      const first = await pool.query<{ user_id: string; seq: string }>(
        `SELECT user_id, seq::text AS seq FROM notifications WHERE reference_id = $1 ORDER BY user_id`,
        [id],
      );
      await pool.query(
        `UPDATE notifications SET is_read = true, popup_dismissed_at = NOW() WHERE reference_id = $1`,
        [id],
      );

      await pool.query(
        `UPDATE todos SET reminder_time = NOW() + interval '1 hour', reminder_sent = false WHERE id = $1`,
        [id],
      );
      await sweepDueTodoReminders();
      expect(await sent(id)).toBe(false);

      await pool.query(`UPDATE todos SET reminder_time = NOW() - interval '1 second' WHERE id = $1`, [id]);
      await sweepDueTodoReminders();
      expect(await sent(id)).toBe(true);
      const again = await pool.query<{ user_id: string; seq: string; is_read: boolean; dismissed: boolean }>(
        `SELECT user_id, seq::text AS seq, is_read, popup_dismissed_at IS NOT NULL AS dismissed
           FROM notifications WHERE type = 'todo_reminder' AND reference_id = $1 ORDER BY user_id`,
        [id],
      );
      expect(again.rows).toHaveLength(2);
      again.rows.forEach((r, i) => {
        expect(r.user_id).toBe(first.rows[i].user_id);
        expect(BigInt(r.seq)).toBeGreaterThan(BigInt(first.rows[i].seq));
        expect(r.is_read).toBe(false);
        expect(r.dismissed).toBe(false);
      });
      expect(await historyCount([id])).toBe(2);
    });
  });

  describe('skipped and failing rows never block deliverable reminders', () => {
    it('does not spin on reminders it has to skip', async () => {
      await Promise.all(
        [1, 2, 3].map(() => addTodo({ business: BIZ_EXPIRED, assignedTo: null, reminderOffsetSec: -60 })),
      );
      const started = Date.now();
      const r = await sweepDueTodoReminders({ batchSize: 2, maxWallMs: 20_000 });
      expect(r.stoppedReason).toBe('complete');
      expect(Date.now() - started).toBeLessThan(10_000);
    });

    it('a full batch of skipped rows ahead of a deliverable reminder does not hide it', async () => {
      const skipped = [];
      for (let i = 0; i < 4; i += 1) skipped.push(await addTodo({ business: BIZ_EXPIRED, reminderOffsetSec: -3600 + i }));
      skipped.push(await addTodo({ assignedTo: null, createdBy: null, reminderOffsetSec: -3500 }));
      const deliverable = await addTodo({ reminderOffsetSec: -10 });

      const r = await sweepDueTodoReminders({ batchSize: 2 });
      expect(r.stoppedReason).toBe('complete');
      expect(await recipients(deliverable)).toEqual([ASSIGNEE, CREATOR].sort());
      for (const id of skipped) expect(await sent(id)).toBe(false);
    });

    it('a full batch of failing rows ahead of a deliverable reminder is passed within one run', async () => {
      await fault(FAULT_A, 'transient');
      const failing = [];
      for (let i = 0; i < 4; i += 1) {
        failing.push(await addTodo({ assignedTo: FAULT_A, createdBy: FAULT_A, reminderOffsetSec: -3600 + i }));
      }
      const deliverable = await addTodo({ reminderOffsetSec: -10 });

      const r = await sweepDueTodoReminders({ businessId: BIZ, batchSize: 2 });
      expect(r).toMatchObject({ stoppedReason: 'complete', failed: 4, processed: 1, total: 5 });
      expect(await sent(deliverable)).toBe(true);
      for (const id of failing) expect(await sent(id)).toBe(false);
    });

    it('a failing backlog longer than one run: the next runs resume, so a later reminder is reached', async () => {
      await fault(FAULT_A, 'transient');
      for (let i = 0; i < 6; i += 1) {
        await addTodo({ assignedTo: FAULT_A, createdBy: FAULT_A, reminderOffsetSec: -3600 + i });
      }
      const deliverable = await addTodo({ reminderOffsetSec: -10 });
      // Each run's budget covers two rows (clock: start, loop check, then one reading per row).
      const run = () => sweepDueTodoReminders({ businessId: BIZ, batchSize: 2, maxWallMs: 3, now: ticking() });

      // Without the remembered position every run restarts at the same failing rows.
      for (let i = 0; i < 4; i += 1) {
        resetSweepPositionsForTests();
        expect((await run()).stoppedReason).toBe('time_limit');
      }
      expect(await sent(deliverable)).toBe(false);

      resetSweepPositionsForTests();
      const results = [];
      for (let i = 0; i < 4 && !(await sent(deliverable)); i += 1) results.push(await run());
      expect(await sent(deliverable)).toBe(true);
      expect(results.map((r) => r.failed)).toEqual([2, 2, 2, 0]);
      expect(results[3].processed).toBe(1);
    });
  });

  describe('the claim re-checks the row', () => {
    it('a snooze between selection and claim prevents delivery; the reminder fires at its new time', async () => {
      const id = await addTodo({ reminderOffsetSec: -60 });
      const snapshot = await row(id);
      await pool.query(
        `UPDATE todos SET reminder_time = NOW() + interval '1 hour', reminder_sent = false WHERE id = $1`,
        [id],
      );

      expect(await triggerTodoReminder(snapshot)).toEqual({ status: 'skipped', reason: 'not_claimed' });
      expect(await recipients(id)).toEqual([]);
      expect(await sent(id)).toBe(false);

      await pool.query(`UPDATE todos SET reminder_time = NOW() - interval '1 second' WHERE id = $1`, [id]);
      await sweepDueTodoReminders({ businessId: BIZ });
      expect(await recipients(id)).toEqual([ASSIGNEE, CREATOR].sort());
    });

    it('completion between selection and claim prevents delivery', async () => {
      const id = await addTodo({ reminderOffsetSec: -60 });
      const snapshot = await row(id);
      await pool.query(`UPDATE todos SET status = 'completed' WHERE id = $1`, [id]);
      expect((await triggerTodoReminder(snapshot)).reason).toBe('not_claimed');
      expect(await recipients(id)).toEqual([]);
      expect(await historyCount([id])).toBe(0);
    });

    it('delivers the claimed row’s title and recipients, not the stale snapshot', async () => {
      const id = await addTodo({ reminderOffsetSec: -60, title: 'old title' });
      const snapshot = await row(id);
      await pool.query(`UPDATE todos SET title = 'new title', assigned_to = $2 WHERE id = $1`, [id, OTHER]);

      expect((await triggerTodoReminder(snapshot)).status).toBe('delivered');
      expect(await recipients(id)).toEqual([OTHER, CREATOR].sort());
      const titles = await pool.query<{ title: string }>(`SELECT title FROM notifications WHERE reference_id = $1`, [id]);
      expect(titles.rows.map((r) => r.title)).toEqual(['Reminder: new title', 'Reminder: new title']);
    });

    it('an old BullMQ job delivers nothing after a snooze or completion', async () => {
      const snoozed = await addTodo({ reminderOffsetSec: -60 });
      await pool.query(`UPDATE todos SET reminder_time = NOW() + interval '1 hour' WHERE id = $1`, [snoozed]);
      const completed = await addTodo({ reminderOffsetSec: -60 });
      await pool.query(`UPDATE todos SET status = 'completed' WHERE id = $1`, [completed]);

      await processTodoReminderJob({ id: `todo-${snoozed}`, data: { todoId: snoozed } });
      await processTodoReminderJob({ id: `todo-${completed}`, data: { todoId: completed } });
      expect(await recipients(snoozed)).toEqual([]);
      expect(await recipients(completed)).toEqual([]);
      expect(await sent(snoozed)).toBe(false);
    });
  });

  describe('insert failures', () => {
    it('a transient failure for every recipient rolls back and leaves the reminder retryable', async () => {
      await fault(FAULT_A, 'transient');
      await fault(FAULT_B, 'transient');
      const id = await addTodo({ assignedTo: FAULT_A, createdBy: FAULT_B, reminderOffsetSec: -60 });

      await expect(triggerTodoReminder(await row(id))).rejects.toMatchObject({ code: '40P01' });
      expect(await sent(id)).toBe(false);
      expect(await recipients(id)).toEqual([]);
      expect(await historyCount([id])).toBe(0);

      await pool.query(`DELETE FROM r5_reminder_faults`);
      await sweepDueTodoReminders({ businessId: BIZ });
      expect(await recipients(id)).toEqual([FAULT_A, FAULT_B].sort());
      expect(await historyCount([id])).toBe(1);
    });

    it('one failing recipient rolls back the other; the retry delivers to both exactly once', async () => {
      await fault(FAULT_B, 'transient');
      const id = await addTodo({ assignedTo: FAULT_A, createdBy: FAULT_B, reminderOffsetSec: -60 });

      const r = await sweepDueTodoReminders({ businessId: BIZ });
      expect(r.failed).toBe(1);
      expect(await recipients(id)).toEqual([]);
      expect(await sent(id)).toBe(false);

      await pool.query(`DELETE FROM r5_reminder_faults`);
      await sweepDueTodoReminders({ businessId: BIZ });
      await sweepDueTodoReminders({ businessId: BIZ });
      expect(await recipients(id)).toEqual([FAULT_A, FAULT_B].sort());
      expect(await historyCount([id])).toBe(1);
    });

    it('skips only a deleted recipient (notifications_user_id_fkey) and delivers to the rest', async () => {
      await fault(FAULT_B, 'deleted_recipient');
      const id = await addTodo({ assignedTo: FAULT_A, createdBy: FAULT_B, reminderOffsetSec: -60 });
      const r = await triggerTodoReminder(await row(id));
      expect(r.status).toBe('delivered');
      expect(await recipients(id)).toEqual([FAULT_A]);
      expect(await sent(id)).toBe(true);
      expect(await historyCount([id])).toBe(1);
    });

    it('keeps the claim when every recipient was deleted (nothing left to retry)', async () => {
      await fault(FAULT_A, 'deleted_recipient');
      const id = await addTodo({ assignedTo: FAULT_A, createdBy: FAULT_A, reminderOffsetSec: -60 });
      expect(await triggerTodoReminder(await row(id))).toEqual({ status: 'skipped', reason: 'recipients_deleted' });
      expect(await sent(id)).toBe(true);
      expect(await historyCount([id])).toBe(0);
    });

    it('an unrelated foreign-key violation fails the delivery and stays retryable', async () => {
      await fault(FAULT_B, 'other_fk');
      const id = await addTodo({ assignedTo: FAULT_A, createdBy: FAULT_B, reminderOffsetSec: -60 });
      await expect(triggerTodoReminder(await row(id))).rejects.toMatchObject({
        code: '23503',
        constraint: 'notifications_business_id_fkey',
      });
      expect(await sent(id)).toBe(false);
      expect(await recipients(id)).toEqual([]);

      await pool.query(`DELETE FROM r5_reminder_faults`);
      await sweepDueTodoReminders({ businessId: BIZ });
      expect(await recipients(id)).toEqual([FAULT_A, FAULT_B].sort());
    });
  });

  describe('concurrency', () => {
    it('overlapping sweeps, routes and worker jobs deliver each reminder once with one history entry', async () => {
      process.env.CRON_SECRET = SECRET;
      const ids = await Promise.all([1, 2, 3, 4, 5].map(() => addTodo({ reminderOffsetSec: -10 })));
      const cron = (path: string) =>
        new NextRequest(`http://localhost${path}`, { headers: { authorization: `Bearer ${SECRET}` } });

      const responses = await Promise.all([
        sweepDueTodoReminders(),
        sweepDueTodoReminders({ businessId: BIZ }),
        checkRemindersGET(cron('/api/todos/check-reminders')),
        sendTodoRemindersGET(cron('/api/cron/send-todo-reminders')),
        ...ids.map((id) => processTodoReminderJob({ id: `todo-${id}`, data: { todoId: id } })),
      ]);
      expect((responses[2] as Response).status).toBe(200);
      expect((responses[3] as Response).status).toBe(200);

      for (const id of ids) expect(await recipients(id)).toEqual([ASSIGNEE, CREATOR].sort());
      expect(await historyCount(ids)).toBe(ids.length);
    });
  });
});
