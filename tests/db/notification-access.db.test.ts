/**
 * Real-PostgreSQL checks for Release 1 notification access rules: read scoping, mark-all-read
 * scoping, session-business membership and invoice-viewed recipients.
 * Runs only when PHASE2_TEST_DATABASE_URL points at a disposable database.
 */
import { randomUUID } from 'crypto';
import type { Pool, PoolClient } from 'pg';

const url = process.env.PHASE2_TEST_DATABASE_URL;
if (url) process.env.DATABASE_URL = url;
const d = url ? describe : describe.skip;

const mockPublish = jest.fn().mockResolvedValue(1);
jest.mock('@/lib/queue/redis', () => ({
  getRedisConnection: () => ({ status: 'ready', publish: mockPublish }),
}));

import { getPool, closePool } from '@/lib/db';
import { withLedgerDelete } from '@/lib/accounting/ledger-delete-guard';
import { userBelongsToSessionBusiness } from '@/lib/notifications/notification-session';
import { markAllNotificationsRead, markNotificationRead } from '@/lib/notifications/read-state';
import { recordInvoiceCustomerView } from '@/lib/customer-surface/record-view';

d('notification access rules (real DB)', () => {
  jest.setTimeout(60000);

  let pool: Pool;
  const BIZ_X = randomUUID();
  const BIZ_Y = randomUUID();
  const ALICE = randomUUID(); // home X
  const BOB = randomUUID(); // home X
  const CAROL = randomUUID(); // member of X, switched to Y
  const DAVE = randomUUID(); // home Y only
  const INACTIVE = randomUUID(); // home X, inactive
  const tag = BIZ_X.slice(0, 8);

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

  async function addNotification(business: string, user: string | null): Promise<string> {
    const r = await pool.query<{ id: string }>(
      `INSERT INTO notifications (business_id, user_id, type, title, message)
       VALUES ($1, $2, 'general', $3, 'msg') RETURNING id`,
      [business, user, `access-${tag}`]
    );
    return r.rows[0].id;
  }

  async function isRead(id: string): Promise<boolean> {
    const r = await pool.query<{ is_read: boolean }>(`SELECT is_read FROM notifications WHERE id = $1`, [id]);
    return r.rows[0].is_read === true;
  }

  beforeAll(async () => {
    pool = getPool();
    for (const biz of [BIZ_X, BIZ_Y]) {
      await pool.query(
        `INSERT INTO businesses (id, name, gstin, state_code, gst_registration_type)
         VALUES ($1, $2, '27AAAPA1234A1Z5', '27', 'regular')`,
        [biz, `Notif access ${tag} ${biz.slice(0, 4)}`]
      );
    }
    const users: [string, string, string, boolean][] = [
      [ALICE, BIZ_X, 'Alice', true],
      [BOB, BIZ_X, 'Bob', true],
      [CAROL, BIZ_Y, 'Carol', true],
      [DAVE, BIZ_Y, 'Dave', true],
      [INACTIVE, BIZ_X, 'Inactive', false],
    ];
    let n = 0;
    for (const [id, biz, name, active] of users) {
      n += 1;
      await pool.query(
        `INSERT INTO users (id, business_id, name, phone, is_active) VALUES ($1, $2, $3, $4, $5)`,
        [id, biz, `${name} ${tag}`, `7${Date.now().toString().slice(-8)}${n}`, active]
      );
    }
    await pool.query(
      `INSERT INTO user_businesses (user_id, business_id, role) VALUES ($1, $2, 'staff'), ($1, $3, 'staff')`,
      [CAROL, BIZ_X, BIZ_Y]
    );
  });

  afterAll(async () => {
    if (!pool) return;
    try {
      await pool.query(`DELETE FROM notifications WHERE business_id = ANY($1::uuid[])`, [[BIZ_X, BIZ_Y]]);
      await pool.query(`DELETE FROM invoice_view_events WHERE business_id = ANY($1::uuid[])`, [[BIZ_X, BIZ_Y]]);
      await pool.query(`DELETE FROM invoices WHERE business_id = ANY($1::uuid[])`, [[BIZ_X, BIZ_Y]]);
      await tx(async (c) => {
        await withLedgerDelete(c, 'tenant_purge', null, async () => {
          await c.query(`DELETE FROM businesses WHERE id = ANY($1::uuid[])`, [[BIZ_X, BIZ_Y]]);
        });
      });
    } finally {
      await closePool();
    }
  });

  describe('session business membership', () => {
    it('accepts the home business', async () => {
      expect(await userBelongsToSessionBusiness(ALICE, BIZ_X)).toBe(true);
    });

    it('accepts a user_businesses member whose users.business_id points elsewhere', async () => {
      expect(await userBelongsToSessionBusiness(CAROL, BIZ_X)).toBe(true);
      expect(await userBelongsToSessionBusiness(CAROL, BIZ_Y)).toBe(true);
    });

    it('refuses a business the user does not belong to', async () => {
      expect(await userBelongsToSessionBusiness(DAVE, BIZ_X)).toBe(false);
      expect(await userBelongsToSessionBusiness(ALICE, BIZ_Y)).toBe(false);
    });

    it('refuses an inactive user', async () => {
      expect(await userBelongsToSessionBusiness(INACTIVE, BIZ_X)).toBe(false);
    });
  });

  describe('mark one notification read', () => {
    it("cannot mark another user's notification in the same business", async () => {
      const bobs = await addNotification(BIZ_X, BOB);
      expect(await markNotificationRead(bobs, BIZ_X, ALICE)).toBe(false);
      expect(await isRead(bobs)).toBe(false);
    });

    it("cannot mark another business's notification, even its broadcasts", async () => {
      const yBroadcast = await addNotification(BIZ_Y, null);
      const daves = await addNotification(BIZ_Y, DAVE);
      expect(await markNotificationRead(yBroadcast, BIZ_X, ALICE)).toBe(false);
      expect(await markNotificationRead(daves, BIZ_X, ALICE)).toBe(false);
      expect(await isRead(yBroadcast)).toBe(false);
      expect(await isRead(daves)).toBe(false);
    });

    it('marks own notifications and broadcasts in the session business', async () => {
      const own = await addNotification(BIZ_X, ALICE);
      const broadcast = await addNotification(BIZ_X, null);
      expect(await markNotificationRead(own, BIZ_X, ALICE)).toBe(true);
      expect(await markNotificationRead(broadcast, BIZ_X, ALICE)).toBe(true);
      expect(await isRead(own)).toBe(true);
      expect(await isRead(broadcast)).toBe(true);
    });

    it('a multi-business member can mark their own notification in the other business', async () => {
      const carolsInX = await addNotification(BIZ_X, CAROL);
      expect(await markNotificationRead(carolsInX, BIZ_X, CAROL)).toBe(true);
    });
  });

  describe('mark all read', () => {
    it("only touches the caller's rows and broadcasts in the session business", async () => {
      const aliceRow = await addNotification(BIZ_X, ALICE);
      const xBroadcast = await addNotification(BIZ_X, null);
      const bobRow = await addNotification(BIZ_X, BOB);
      const yBroadcast = await addNotification(BIZ_Y, null);
      const daveRow = await addNotification(BIZ_Y, DAVE);

      await markAllNotificationsRead(BIZ_X, ALICE);

      expect(await isRead(aliceRow)).toBe(true);
      expect(await isRead(xBroadcast)).toBe(true);
      expect(await isRead(bobRow)).toBe(false);
      expect(await isRead(yBroadcast)).toBe(false);
      expect(await isRead(daveRow)).toBe(false);
    });
  });

  describe('invoice viewed recipients', () => {
    it('publishes to home users and switched members, never to other businesses or inactive users', async () => {
      const branch = randomUUID();
      await pool.query(
        `INSERT INTO branches (id, business_id, name, state_code, is_primary, is_default, is_active)
         VALUES ($1, $2, 'Main', '27', true, true, true)`,
        [branch, BIZ_X]
      );
      const inv = await pool.query<{ id: string }>(
        `INSERT INTO invoices (business_id, invoice_number, invoice_date, status, branch_id)
         VALUES ($1, $2, CURRENT_DATE, 'draft', $3) RETURNING id`,
        [BIZ_X, `ACC-${tag}`, branch]
      );
      mockPublish.mockClear();

      await recordInvoiceCustomerView({
        invoiceId: inv.rows[0].id,
        businessId: BIZ_X,
        customerName: 'Asha',
        invoiceNumber: `ACC-${tag}`,
        source: 'public_link',
      });

      const recipients = mockPublish.mock.calls.map(([, p]) => JSON.parse(p).userId).sort();
      expect(recipients).toEqual([ALICE, BOB, CAROL].sort());
    });
  });
});
