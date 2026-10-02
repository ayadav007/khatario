/**
 * Release 4.1: GET /api/notifications stream_cursor against real PostgreSQL (needs 337/338).
 * The list is the top 20 by created_at, which does not follow seq order, so a row outside the
 * list can carry a higher seq; stream_cursor must still cover it (own and broadcast rows), stay
 * scoped to the session business/user, and be '0' when nothing is visible.
 * Runs only when PHASE2_TEST_DATABASE_URL points at a disposable database.
 */
import { randomUUID } from 'crypto';
import type { Pool } from 'pg';
import { NextRequest } from 'next/server';

const url = process.env.PHASE2_TEST_DATABASE_URL;
if (url) process.env.DATABASE_URL = url;
const d = url ? describe : describe.skip;

jest.mock('@/lib/queue/redis', () => ({ getRedisConnection: () => null }));
jest.mock('@/lib/auth-helpers', () => ({
  ...jest.requireActual('@/lib/auth-helpers'),
  requirePortalSession: async () => null,
}));

import { getPool, closePool } from '@/lib/db';
import { withLedgerDelete } from '@/lib/accounting/ledger-delete-guard';
import { dbStreamSource } from '@/lib/notifications/stream/catch-up';
import { GET } from '@/app/api/notifications/route';

d('GET /api/notifications stream_cursor (real DB)', () => {
  jest.setTimeout(60000);

  let pool: Pool;
  const BIZ_A = randomUUID();
  const BIZ_B = randomUUID();
  const BIZ_EMPTY = randomUUID();
  const ALICE = randomUUID();
  const BOB = randomUUID();

  async function add(business: string, user: string | null, createdAt: string, type = 'general') {
    const r = await pool.query<{ id: string; seq: string }>(
      `INSERT INTO notifications (business_id, user_id, type, title, message, created_at)
       VALUES ($1, $2, $3, 'cursor test', 'msg', LOCALTIMESTAMP - $4::interval) RETURNING id, seq::text AS seq`,
      [business, user, type, createdAt]
    );
    return r.rows[0];
  }

  async function get(business: string, user: string) {
    const res = await GET(
      new NextRequest(`http://localhost/api/notifications?business_id=${business}&limit=20`, {
        headers: {
          'x-authenticated-user-id': user,
          'x-authenticated-business-id': business,
          'x-authenticated-session-version': '1',
        },
      })
    );
    expect(res.status).toBe(200);
    return (await res.json()) as { notifications: { id: string; seq: string }[]; stream_cursor: string | null };
  }

  const maxSeq = (rows: { seq: string }[]) => rows.reduce((m, r) => (BigInt(r.seq) > m ? BigInt(r.seq) : m), 0n);

  beforeAll(async () => {
    pool = getPool();
    for (const biz of [BIZ_A, BIZ_B, BIZ_EMPTY]) {
      await pool.query(
        `INSERT INTO businesses (id, name, gstin, state_code, gst_registration_type)
         VALUES ($1, $2, '27AAAPA1234A1Z5', '27', 'regular')`,
        [biz, `Cursor ${biz.slice(0, 8)}`]
      );
    }
    let n = 0;
    for (const id of [ALICE, BOB]) {
      n += 1;
      await pool.query(`INSERT INTO users (id, business_id, name, phone, is_active) VALUES ($1, $2, $3, $4, true)`, [
        id,
        BIZ_A,
        `Cursor user ${n}`,
        `6${Date.now().toString().slice(-8)}${n}`,
      ]);
    }
  });

  afterAll(async () => {
    if (!pool) return;
    try {
      await pool.query(`DELETE FROM notifications WHERE business_id = ANY($1::uuid[])`, [[BIZ_A, BIZ_B, BIZ_EMPTY]]);
      const c = await pool.connect();
      try {
        await c.query('BEGIN');
        await withLedgerDelete(c, 'tenant_purge', null, async () => {
          await c.query(`DELETE FROM businesses WHERE id = ANY($1::uuid[])`, [[BIZ_A, BIZ_B, BIZ_EMPTY]]);
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

  it("returns '0' and an empty list when nothing is visible", async () => {
    expect(await get(BIZ_EMPTY, ALICE)).toMatchObject({ notifications: [], stream_cursor: '0' });
  });

  it('covers own and broadcast rows that are outside the top 20 but have a higher seq', async () => {
    // Oldest first, so these 22 rows have created_at and seq in the same order.
    for (let i = 22; i >= 1; i -= 1) await add(BIZ_A, i % 2 ? ALICE : null, `${i} minutes`);

    // Older created_at, newer seq: e.g. a long transaction (created_at = transaction start).
    const ownOutside = await add(BIZ_A, ALICE, '10 days', 'todo_reminder');
    let body = await get(BIZ_A, ALICE);
    expect(body.notifications).toHaveLength(20);
    expect(body.notifications.map((r) => r.id)).not.toContain(ownOutside.id);
    const listMax = maxSeq(body.notifications);
    expect(BigInt(ownOutside.seq)).toBeGreaterThan(listMax);
    expect(body.stream_cursor).toBe(ownOutside.seq);

    const broadcastOutside = await add(BIZ_A, null, '11 days');
    body = await get(BIZ_A, ALICE);
    expect(body.notifications.map((r) => r.id)).not.toContain(broadcastOutside.id);
    expect(body.stream_cursor).toBe(broadcastOutside.seq);

    // What the stream would replay from each starting point.
    const scope = { businessId: BIZ_A, userId: ALICE };
    const fromListMax = await dbStreamSource.fetchAfter(scope, listMax, 100);
    expect(fromListMax.map((r) => r.id).sort()).toEqual([ownOutside.id, broadcastOutside.id].sort());
    expect(await dbStreamSource.fetchAfter(scope, BigInt(body.stream_cursor!), 100)).toEqual([]);
  });

  it("is scoped to the session business and user (other users' and businesses' rows never count)", async () => {
    const before = (await get(BIZ_A, ALICE)).stream_cursor!;
    const bobs = await add(BIZ_A, BOB, '0 minutes');
    const aliceElsewhere = await add(BIZ_B, ALICE, '0 minutes');
    expect(BigInt(aliceElsewhere.seq)).toBeGreaterThan(BigInt(before));

    expect((await get(BIZ_A, ALICE)).stream_cursor).toBe(before);
    const bob = await get(BIZ_A, BOB);
    expect(bob.stream_cursor).toBe(bobs.seq);
    expect(bob.notifications.map((r) => r.id)).toContain(bobs.id);
    expect((await get(BIZ_B, ALICE)).stream_cursor).toBe(aliceElsewhere.seq);
    expect((await get(BIZ_B, BOB)).stream_cursor).toBe('0');
  });
});
