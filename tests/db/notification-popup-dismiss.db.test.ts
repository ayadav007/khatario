/**
 * Release 4 popup dismissal against real PostgreSQL (needs migrations 337/338): scoping, the
 * seq guard, and a re-fire after dismissal popping again (trigger clears popup_dismissed_at).
 * Runs only when PHASE2_TEST_DATABASE_URL points at a disposable database.
 */
import { randomUUID } from 'crypto';
import type { Pool } from 'pg';

const url = process.env.PHASE2_TEST_DATABASE_URL;
if (url) process.env.DATABASE_URL = url;
const d = url ? describe : describe.skip;

jest.mock('@/lib/queue/redis', () => ({ getRedisConnection: () => null }));

import { getPool, closePool } from '@/lib/db';
import { withLedgerDelete } from '@/lib/accounting/ledger-delete-guard';
import { dismissNotificationPopups } from '@/lib/notifications/popup-state';

d('reminder popup dismissal (real DB)', () => {
  jest.setTimeout(60000);

  let pool: Pool;
  const BIZ = randomUUID();
  const OTHER_BIZ = randomUUID();
  const ALICE = randomUUID();
  const BOB = randomUUID();

  async function add(business: string, user: string | null, type = 'todo_reminder') {
    const r = await pool.query<{ id: string; seq: string }>(
      `INSERT INTO notifications (business_id, user_id, type, title, message)
       VALUES ($1, $2, $3, 'Reminder: test', 'msg') RETURNING id, seq::text AS seq`,
      [business, user, type]
    );
    return r.rows[0];
  }

  async function state(id: string) {
    const r = await pool.query<{ dismissed: boolean; seq: string }>(
      `SELECT popup_dismissed_at IS NOT NULL AS dismissed, seq::text AS seq FROM notifications WHERE id = $1`,
      [id]
    );
    return r.rows[0];
  }

  beforeAll(async () => {
    pool = getPool();
    for (const biz of [BIZ, OTHER_BIZ]) {
      await pool.query(
        `INSERT INTO businesses (id, name, gstin, state_code, gst_registration_type)
         VALUES ($1, $2, '27AAAPA1234A1Z5', '27', 'regular')`,
        [biz, `Popup ${biz.slice(0, 8)}`]
      );
    }
    let n = 0;
    for (const [id, biz] of [
      [ALICE, BIZ],
      [BOB, BIZ],
    ]) {
      n += 1;
      await pool.query(`INSERT INTO users (id, business_id, name, phone, is_active) VALUES ($1, $2, $3, $4, true)`, [
        id,
        biz,
        `Popup user ${n}`,
        `5${Date.now().toString().slice(-8)}${n}`,
      ]);
    }
  });

  afterAll(async () => {
    if (!pool) return;
    try {
      await pool.query(`DELETE FROM notifications WHERE business_id = ANY($1::uuid[])`, [[BIZ, OTHER_BIZ]]);
      const c = await pool.connect();
      try {
        await c.query('BEGIN');
        await withLedgerDelete(c, 'tenant_purge', null, async () => {
          await c.query(`DELETE FROM businesses WHERE id = ANY($1::uuid[])`, [[BIZ, OTHER_BIZ]]);
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

  it("dismisses the caller's own reminder only", async () => {
    const mine = await add(BIZ, ALICE);
    const bobs = await add(BIZ, BOB);
    const broadcast = await add(BIZ, null, 'general');
    const foreign = await add(OTHER_BIZ, ALICE);

    const done = await dismissNotificationPopups(BIZ, ALICE, [mine, bobs, broadcast, foreign]);
    expect(done).toEqual([mine.id]);
    expect((await state(mine.id)).dismissed).toBe(true);
    expect((await state(bobs.id)).dismissed).toBe(false);
    expect((await state(broadcast.id)).dismissed).toBe(false);
    expect((await state(foreign.id)).dismissed).toBe(false);
  });

  it('does not dismiss a re-fire the user has not seen yet, and a re-fire after dismissal pops again', async () => {
    const r = await add(BIZ, ALICE);
    await dismissNotificationPopups(BIZ, ALICE, [r]);
    expect((await state(r.id)).dismissed).toBe(true);

    await pool.query(`UPDATE notifications SET created_at = created_at + interval '1 second' WHERE id = $1`, [r.id]);
    const refired = await state(r.id);
    expect(refired.dismissed).toBe(false);
    expect(BigInt(refired.seq)).toBeGreaterThan(BigInt(r.seq));

    // A dismissal sent for the old occurrence (stale tab) leaves the new one popping.
    expect(await dismissNotificationPopups(BIZ, ALICE, [r])).toEqual([]);
    expect((await state(r.id)).dismissed).toBe(false);

    expect(await dismissNotificationPopups(BIZ, ALICE, [{ id: r.id, seq: refired.seq }])).toEqual([r.id]);
    expect((await state(r.id)).dismissed).toBe(true);
  });
});
