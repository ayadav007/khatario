/**
 * Real-PostgreSQL checks for notifications Release 2 (migrations 337 + 338): seq backfill,
 * automatic seq on insert, new seq on re-fired reminders, broadcast read receipts, indexes.
 *
 * Resets the disposable test database to the pre-337 notification schema, inserts legacy rows,
 * then applies both files the way scripts/run-pending-migrations.js does (337 in one
 * transaction, 338 statement by statement in autocommit) while other connections keep inserting.
 * Runs only when PHASE2_TEST_DATABASE_URL points at a disposable database.
 */
import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import type { Pool, PoolClient } from 'pg';

const url = process.env.PHASE2_TEST_DATABASE_URL;
if (url) process.env.DATABASE_URL = url;
const d = url ? describe : describe.skip;

import { getPool, closePool } from '@/lib/db';
import { withLedgerDelete } from '@/lib/accounting/ledger-delete-guard';

const runner = require('../../scripts/run-pending-migrations.js') as {
  unwrapExplicitTransaction: (sql: string) => string | null;
  splitSqlStatements: (sql: string) => string[];
  needsAutocommit: (sql: string) => boolean;
};

const MIGRATIONS = path.join(__dirname, '../../database/migrations');
const SQL_337 = fs.readFileSync(path.join(MIGRATIONS, '337_notifications_seq_foundation.sql'), 'utf8');
const SQL_338 = fs.readFileSync(path.join(MIGRATIONS, '338_notifications_seq_backfill_indexes.sql'), 'utf8');
const RESERVED = 1_000_000_000_000n;

/** Same statement as lib/services/todoReminderService.ts (reminder delivery is unchanged). */
const REMINDER_UPSERT = `INSERT INTO notifications (
    business_id, user_id, type, title, message, reference_type, reference_id, created_at
  ) VALUES ($1, $2, 'todo_reminder', $3, $4, 'todo', $5, NOW())
  ON CONFLICT (user_id, reference_id) WHERE (type = 'todo_reminder')
  DO UPDATE SET
    title = EXCLUDED.title,
    message = EXCLUDED.message,
    is_read = false,
    read_at = NULL,
    created_at = NOW()
  RETURNING id`;

d('notifications seq foundation (real DB)', () => {
  jest.setTimeout(180000);

  let pool: Pool;
  const BIZ = randomUUID();
  const ALICE = randomUUID();
  const BOB = randomUUID();
  const tag = BIZ.slice(0, 8);
  const LEGACY_BULK = 3000;
  const CONCURRENT_INSERTS = 300;
  let legacyIds: string[] = [];

  async function apply337() {
    expect(runner.needsAutocommit(SQL_337)).toBe(false);
    const sql = runner.unwrapExplicitTransaction(SQL_337);
    expect(sql).not.toBeNull();
    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      await c.query(sql as string);
      await c.query('COMMIT');
    } catch (e) {
      await c.query('ROLLBACK').catch(() => {});
      throw e;
    } finally {
      c.release();
    }
  }

  async function apply338() {
    expect(runner.needsAutocommit(SQL_338)).toBe(true);
    const c = await pool.connect();
    try {
      for (const stmt of runner.splitSqlStatements(SQL_338)) await c.query(stmt);
    } finally {
      c.release();
    }
  }

  async function withClient<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
    const c = await pool.connect();
    try {
      return await fn(c);
    } finally {
      c.release();
    }
  }

  /** Disposable DB only: put the notification schema back to what 337 expects. */
  async function resetToPre337() {
    await pool.query(`DROP TRIGGER IF EXISTS trg_notifications_refire_seq ON notifications`);
    await pool.query(`DROP FUNCTION IF EXISTS notifications_refire_new_seq()`);
    await pool.query(`DROP TABLE IF EXISTS notification_reads`);
    await pool.query(`ALTER TABLE notifications DROP COLUMN IF EXISTS seq`);
    await pool.query(`ALTER TABLE notifications DROP COLUMN IF EXISTS popup_dismissed_at`);
    await pool.query(`DROP SEQUENCE IF EXISTS notifications_seq`);
    await pool.query(`DROP INDEX IF EXISTS idx_todos_reminder_sweep`);
    await pool.query(`DROP PROCEDURE IF EXISTS notifications_backfill_seq(integer)`);
    await pool.query(`DROP PROCEDURE IF EXISTS notifications_seq_set_not_null()`);
    await pool.query(`DROP PROCEDURE IF EXISTS notifications_r2_drop_invalid_indexes()`);
  }

  async function insertGeneral(title: string, user: string | null = null): Promise<{ id: string; seq: string }> {
    const r = await pool.query<{ id: string; seq: string }>(
      `INSERT INTO notifications (business_id, user_id, type, title, message)
       VALUES ($1, $2, 'general', $3, 'msg') RETURNING id, seq`,
      [BIZ, user, title]
    );
    return r.rows[0];
  }

  beforeAll(async () => {
    pool = getPool();
    await pool.query(
      `INSERT INTO businesses (id, name, gstin, state_code, gst_registration_type)
       VALUES ($1, $2, '27AAAPA1234A1Z5', '27', 'regular')`,
      [BIZ, `Notif seq ${tag}`]
    );
    let n = 0;
    for (const [id, name] of [[ALICE, 'Alice'], [BOB, 'Bob']]) {
      n += 1;
      await pool.query(`INSERT INTO users (id, business_id, name, phone, is_active) VALUES ($1, $2, $3, $4, true)`, [
        id,
        BIZ,
        `${name} ${tag}`,
        `6${Date.now().toString().slice(-8)}${n}`,
      ]);
    }

    await resetToPre337();

    // Legacy rows: a NULL created_at, a created_at tie (broken by id), and a bulk set.
    const legacy = await pool.query<{ id: string }>(
      `INSERT INTO notifications (business_id, user_id, type, title, message, created_at)
       VALUES ($1, $2, 'general', $3, 'legacy', NULL),
              ($1, $2, 'general', $3, 'legacy', '2020-01-01 10:00:00'),
              ($1, NULL, 'general', $3, 'legacy', '2020-01-01 10:00:00'),
              ($1, $2, 'general', $3, 'legacy', '2019-06-01 09:00:00')
       RETURNING id`,
      [BIZ, ALICE, `legacy-${tag}`]
    );
    legacyIds = legacy.rows.map((r) => r.id);
    await pool.query(
      `INSERT INTO notifications (business_id, user_id, type, title, message, created_at)
       SELECT $1, CASE WHEN g % 3 = 0 THEN NULL ELSE $2::uuid END, 'general', $3, 'bulk',
              TIMESTAMP '2021-01-01' + (g || ' minutes')::interval
         FROM generate_series(1, $4::int) g`,
      [BIZ, ALICE, `legacy-${tag}`, LEGACY_BULK]
    );

    await apply337();

    // 338 runs while other connections keep inserting, as on a live server.
    const inserts = (async () => {
      for (let i = 0; i < CONCURRENT_INSERTS; i += 1) await insertGeneral(`during-${tag}`, i % 2 ? ALICE : null);
    })();
    await Promise.all([apply338(), inserts]);
  });

  afterAll(async () => {
    if (!pool) return;
    try {
      await pool.query(`DELETE FROM notifications WHERE business_id = $1`, [BIZ]);
      await withClient(async (c) => {
        await c.query('BEGIN');
        await withLedgerDelete(c, 'tenant_purge', null, async () => {
          await c.query(`DELETE FROM businesses WHERE id = $1`, [BIZ]);
        });
        await c.query('COMMIT');
      });
    } finally {
      await closePool();
    }
  });

  describe('backfill of existing notifications', () => {
    it('leaves no NULL and no duplicate seq anywhere in the table, and seq is NOT NULL', async () => {
      const r = await pool.query<{ nulls: string; dups: string; notnull: boolean }>(
        `SELECT (SELECT count(*) FROM notifications WHERE seq IS NULL) AS nulls,
                (SELECT count(*) FROM (SELECT seq FROM notifications GROUP BY seq HAVING count(*) > 1) x) AS dups,
                (SELECT attnotnull FROM pg_attribute
                  WHERE attrelid = 'notifications'::regclass AND attname = 'seq') AS notnull`
      );
      expect(r.rows[0]).toEqual({ nulls: '0', dups: '0', notnull: true });
    });

    it('numbers pre-existing rows below the reserved range in (created_at, id) order', async () => {
      const r = await pool.query<{ id: string; seq: string }>(
        `SELECT id, seq FROM notifications WHERE business_id = $1 AND title = $2
          ORDER BY created_at NULLS FIRST, id`,
        [BIZ, `legacy-${tag}`]
      );
      expect(r.rows).toHaveLength(LEGACY_BULK + legacyIds.length);
      const seqs = r.rows.map((row) => BigInt(row.seq));
      seqs.forEach((s, i) => {
        expect(s < RESERVED).toBe(true);
        if (i > 0) expect(s > seqs[i - 1]).toBe(true);
      });
      // NULL created_at sorts first; the tie at 2020-01-01 10:00 is broken by id.
      expect(r.rows[0].id).toBe(legacyIds[0]);
    });

    it('gives rows inserted during the backfill a seq above every backfilled row', async () => {
      const r = await pool.query<{ n: string; min_seq: string }>(
        `SELECT count(*) AS n, min(seq) AS min_seq FROM notifications WHERE business_id = $1 AND title = $2`,
        [BIZ, `during-${tag}`]
      );
      expect(r.rows[0].n).toBe(String(CONCURRENT_INSERTS));
      expect(BigInt(r.rows[0].min_seq) >= RESERVED).toBe(true);
    });

    it('drops the temporary backfill index', async () => {
      const r = await pool.query(`SELECT to_regclass('idx_notifications_seq_backfill') AS idx`);
      expect(r.rows[0].idx).toBeNull();
    });

    it('re-running 338 is a no-op that keeps every seq', async () => {
      const before = await pool.query(`SELECT md5(string_agg(id::text || ':' || seq, ',' ORDER BY id)) AS h FROM notifications`);
      await apply338();
      const after = await pool.query(`SELECT md5(string_agg(id::text || ':' || seq, ',' ORDER BY id)) AS h FROM notifications`);
      expect(after.rows[0].h).toBe(before.rows[0].h);
    });

    it('resumes an interrupted backfill after the last committed batch', async () => {
      const maxBefore = await pool.query<{ m: string }>(
        `SELECT max(seq) AS m FROM notifications WHERE seq < $1`,
        [RESERVED.toString()]
      );
      await pool.query(`ALTER TABLE notifications ALTER COLUMN seq DROP NOT NULL`);
      const reset = await pool.query<{ id: string }>(
        `UPDATE notifications SET seq = NULL
          WHERE id IN (SELECT id FROM notifications WHERE business_id = $1 AND title = $2 ORDER BY id LIMIT 7)
          RETURNING id`,
        [BIZ, `legacy-${tag}`]
      );
      await pool.query(`CALL notifications_backfill_seq(3)`);
      await pool.query(`CALL notifications_seq_set_not_null()`);

      const r = await pool.query<{ seq: string }>(`SELECT seq FROM notifications WHERE id = ANY($1::uuid[]) ORDER BY seq`, [
        reset.rows.map((x) => x.id),
      ]);
      expect(r.rows.map((x) => BigInt(x.seq))).toEqual(
        Array.from({ length: 7 }, (_, i) => BigInt(maxBefore.rows[0].m) + BigInt(i + 1))
      );
      const notnull = await pool.query(
        `SELECT attnotnull FROM pg_attribute WHERE attrelid = 'notifications'::regclass AND attname = 'seq'`
      );
      expect(notnull.rows[0].attnotnull).toBe(true);
    });

    it('refuses to set NOT NULL while a row is still unnumbered', async () => {
      await pool.query(`ALTER TABLE notifications ALTER COLUMN seq DROP NOT NULL`);
      const { id } = await insertGeneral(`gap-${tag}`);
      await pool.query(`UPDATE notifications SET seq = NULL WHERE id = $1`, [id]);
      await expect(pool.query(`CALL notifications_seq_set_not_null()`)).rejects.toThrow(/notifications_seq_not_null/);
      await pool.query(`CALL notifications_backfill_seq(5000)`);
      await pool.query(`CALL notifications_seq_set_not_null()`);
      const r = await pool.query(
        `SELECT (SELECT attnotnull FROM pg_attribute WHERE attrelid = 'notifications'::regclass AND attname = 'seq') AS nn,
                (SELECT count(*) FROM pg_constraint WHERE conname = 'notifications_seq_not_null') AS leftover`
      );
      expect(r.rows[0]).toEqual({ nn: true, leftover: '0' });
    });
  });

  describe('new notifications', () => {
    it('get increasing seq values automatically', async () => {
      const a = await insertGeneral(`new-${tag}`);
      const b = await insertGeneral(`new-${tag}`, BOB);
      expect(a.seq).not.toBeNull();
      expect(BigInt(a.seq) >= RESERVED).toBe(true);
      expect(BigInt(b.seq) > BigInt(a.seq)).toBe(true);
    });
  });

  describe('re-fired todo reminders', () => {
    it('keep their id, get a new seq and a cleared popup_dismissed_at; reads do not change seq', async () => {
      const todoId = randomUUID();
      const first = await pool.query<{ id: string }>(REMINDER_UPSERT, [BIZ, ALICE, 'Reminder', 'first', todoId]);
      const id = first.rows[0].id;
      const s1 = (await pool.query<{ seq: string }>(`SELECT seq FROM notifications WHERE id = $1`, [id])).rows[0].seq;

      await pool.query(`UPDATE notifications SET is_read = true, read_at = NOW(), popup_dismissed_at = NOW() WHERE id = $1`, [id]);
      const afterRead = await pool.query(`SELECT seq, popup_dismissed_at FROM notifications WHERE id = $1`, [id]);
      expect(afterRead.rows[0].seq).toBe(s1);
      expect(afterRead.rows[0].popup_dismissed_at).not.toBeNull();

      const again = await pool.query<{ id: string }>(REMINDER_UPSERT, [BIZ, ALICE, 'Reminder', 'second', todoId]);
      expect(again.rows[0].id).toBe(id);
      const r = await pool.query(`SELECT seq, popup_dismissed_at, is_read, message FROM notifications WHERE id = $1`, [id]);
      expect(BigInt(r.rows[0].seq) > BigInt(s1)).toBe(true);
      expect(r.rows[0]).toMatchObject({ popup_dismissed_at: null, is_read: false, message: 'second' });

      const count = await pool.query(`SELECT count(*) AS n FROM notifications WHERE reference_id = $1`, [todoId]);
      expect(count.rows[0].n).toBe('1');
    });

    it('does not re-sequence other notification types when created_at changes', async () => {
      const { id, seq } = await insertGeneral(`other-${tag}`);
      await pool.query(`UPDATE notifications SET created_at = created_at + interval '1 minute' WHERE id = $1`, [id]);
      const r = await pool.query(`SELECT seq FROM notifications WHERE id = $1`, [id]);
      expect(r.rows[0].seq).toBe(seq);
    });
  });

  describe('broadcast read receipts', () => {
    it('allow one receipt per notification and user, and cascade with the notification', async () => {
      const { id } = await insertGeneral(`broadcast-${tag}`, null);
      await pool.query(`INSERT INTO notification_reads (notification_id, user_id) VALUES ($1, $2), ($1, $3)`, [id, ALICE, BOB]);
      await expect(
        pool.query(`INSERT INTO notification_reads (notification_id, user_id) VALUES ($1, $2)`, [id, ALICE])
      ).rejects.toMatchObject({ code: '23505' });
      const idem = await pool.query(
        `INSERT INTO notification_reads (notification_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [id, ALICE]
      );
      expect(idem.rowCount).toBe(0);

      await pool.query(`DELETE FROM notifications WHERE id = $1`, [id]);
      const left = await pool.query(`SELECT count(*) AS n FROM notification_reads WHERE notification_id = $1`, [id]);
      expect(left.rows[0].n).toBe('0');
    });
  });

  describe('indexes', () => {
    it('are all valid', async () => {
      const r = await pool.query<{ relname: string; indisvalid: boolean }>(
        `SELECT c.relname, i.indisvalid FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
          WHERE c.relname IN ('uq_notifications_seq', 'idx_notifications_business_user_seq',
                              'idx_todos_reminder_sweep', 'notification_reads_pkey')
          ORDER BY 1`
      );
      expect(r.rows).toEqual([
        { relname: 'idx_notifications_business_user_seq', indisvalid: true },
        { relname: 'idx_todos_reminder_sweep', indisvalid: true },
        { relname: 'notification_reads_pkey', indisvalid: true },
        { relname: 'uq_notifications_seq', indisvalid: true },
      ]);
    });

    async function plan(sql: string, params: unknown[]): Promise<string> {
      return withClient(async (c) => {
        await c.query('BEGIN');
        try {
          await c.query('SET LOCAL enable_seqscan = off');
          const r = await c.query(`EXPLAIN ${sql}`, params);
          return r.rows.map((row: Record<string, string>) => row['QUERY PLAN']).join('\n');
        } finally {
          await c.query('ROLLBACK');
        }
      });
    }

    // Whether the planner prefers this index over a walk of uq_notifications_seq (or a seq scan of
    // this tiny table) depends on how small one business is relative to the table, so both are
    // ruled out here.
    it('serve catch-up by business, user and seq', async () => {
      const p = await withClient(async (c) => {
        await c.query('BEGIN');
        try {
          await c.query('DROP INDEX uq_notifications_seq');
          await c.query('ANALYZE notifications');
          await c.query('SET LOCAL enable_seqscan = off');
          // One ordered index range per branch; an OR across user_id cannot use ordered ranges.
          const r = await c.query(
            `EXPLAIN SELECT id, seq FROM (
               (SELECT id, seq FROM notifications
                 WHERE business_id = $1 AND user_id = $2 AND seq > $3 ORDER BY seq LIMIT 200)
               UNION ALL
               (SELECT id, seq FROM notifications
                 WHERE business_id = $1 AND user_id IS NULL AND seq > $3 ORDER BY seq LIMIT 200)
             ) x ORDER BY seq LIMIT 200`,
            [BIZ, ALICE, '0']
          );
          return r.rows.map((row: Record<string, string>) => row['QUERY PLAN']).join('\n');
        } finally {
          await c.query('ROLLBACK');
        }
      });
      expect(p).toMatch(/idx_notifications_business_user_seq[\s\S]*idx_notifications_business_user_seq/);
      expect(p).toMatch(/Index Cond: \(\(business_id = .*\) AND \(user_id IS NULL\) AND \(seq > /);
    });

    it('serve the all-business pending reminder sweep', async () => {
      await pool.query('ANALYZE todos');
      const p = await plan(
        `SELECT t.* FROM todos t
          WHERE t.status IN ('pending', 'in_progress', 'overdue')
            AND t.reminder_sent = false
            AND t.reminder_type IS NOT NULL
            AND t.reminder_type != 'none'
            AND t.reminder_time IS NOT NULL
            AND t.reminder_time <= NOW()
          ORDER BY t.reminder_time ASC
          LIMIT $1`,
        [100]
      );
      expect(p).toContain('idx_todos_reminder_sweep');
    });

    it('enforce unique seq', async () => {
      const { seq } = await insertGeneral(`dup-${tag}`);
      await expect(
        pool.query(
          `INSERT INTO notifications (business_id, type, title, message, seq) VALUES ($1, 'general', $2, 'x', $3)`,
          [BIZ, `dup-${tag}`, seq]
        )
      ).rejects.toMatchObject({ code: '23505' });
    });
  });
});
