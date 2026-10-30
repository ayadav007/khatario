/**
 * Abandoned-cart routes on a real database (store shopping features, phase 4, task 21): the cron
 * route (bearer guard, claim + send + purge counts), the admin open-carts list, the manual remind
 * route (24 h gap, store off, other business), and the two reminder settings on the online-store
 * route. Opt-in, disposable DB only:
 *   STORE_FEATURES_DB_TEST=1 npx jest tests/db/store-abandoned-cart-routes.db.test.ts --runInBand
 * (or set PHASE2_TEST_DATABASE_URL). Connection details come from .env with the database forced
 * to kh_phase2_test; migration 449 must be applied there.
 */
import { randomUUID } from 'crypto';
import type { Pool } from 'pg';
import { NextRequest } from 'next/server';
import { config as loadEnv } from 'dotenv';

const TEST_DB = 'kh_phase2_test';
const enabled = !!process.env.PHASE2_TEST_DATABASE_URL || process.env.STORE_FEATURES_DB_TEST === '1';
if (process.env.PHASE2_TEST_DATABASE_URL) {
  process.env.DATABASE_URL = process.env.PHASE2_TEST_DATABASE_URL;
} else if (enabled) {
  const env: Record<string, string> = {};
  loadEnv({ path: '.env', processEnv: env });
  const auth = `${encodeURIComponent(env.DB_USER || 'postgres')}:${encodeURIComponent(env.DB_PASSWORD || '')}`;
  process.env.DATABASE_URL = `postgresql://${auth}@localhost:${env.DB_PORT || '5432'}/${TEST_DB}`;
  process.env.DB_SSL = 'false';
}
const d = enabled ? describe : describe.skip;

jest.mock('@/lib/store/notify-whatsapp', () => ({ notifyStoreEvent: jest.fn(), notifyStoreCustomerWhatsApp: jest.fn() }));
jest.mock('@/lib/push/customer-push', () => ({ enqueueCustomerPush: jest.fn() }));
jest.mock('@/lib/jwt', () => ({ clearSessionCookie: jest.fn() }));
jest.mock('next/headers', () => ({
  headers: jest.fn(async () => ({ get: () => null })),
  cookies: jest.fn(async () => ({ get: () => undefined })),
}));
jest.mock('@/lib/authorization', () => ({
  ...jest.requireActual('@/lib/authorization'),
  authorize: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('@/lib/auth-helpers', () => ({
  ...jest.requireActual('@/lib/auth-helpers'),
  requireStrictSession: jest.fn(async (request: any) => ({
    ok: true,
    userId: request.headers.get('x-authenticated-user-id'),
    businessId: request.headers.get('x-authenticated-business-id'),
  })),
}));
jest.mock('@/lib/subscription/feature-access', () => ({
  ...jest.requireActual('@/lib/subscription/feature-access'),
  hasFeatureAccess: jest.fn().mockResolvedValue(true),
  assertFeatureAccess: jest.fn().mockResolvedValue(undefined),
  denyIfFeatureMissing: jest.fn().mockResolvedValue(null),
}));
jest.mock('@/lib/rag/tenant-reindex', () => ({ noteShopChanged: jest.fn() }));
process.env.NEXT_PUBLIC_APP_URL = 'https://staging.khatario.com';
process.env.CRON_SECRET = 'test-cron-secret';

import { NextResponse } from 'next/server';
import { authorize, AuthorizationError } from '@/lib/authorization';
import { denyIfFeatureMissing } from '@/lib/subscription/feature-access';
import { getPool, closePool } from '@/lib/db';
import { withLedgerDelete } from '@/lib/accounting/ledger-delete-guard';
import { notifyStoreEvent } from '@/lib/store/notify-whatsapp';
import { enqueueCustomerPush } from '@/lib/push/customer-push';
import { saveCart, type CartLine } from '@/lib/store/abandoned-carts';
import { GET as cron } from '@/app/api/cron/abandoned-carts/route';
import { GET as listCarts } from '@/app/api/settings/online-store/abandoned-carts/route';
import { POST as remind } from '@/app/api/settings/online-store/abandoned-carts/[id]/remind/route';
import { GET as getStore, PATCH as patchStore } from '@/app/api/settings/online-store/route';

const mockPush = enqueueCustomerPush as jest.Mock;
const mockWa = notifyStoreEvent as jest.Mock;

d('store abandoned-cart routes (real DB)', () => {
  jest.setTimeout(120000);

  let pool: Pool;
  const B = randomUUID(); // reminders on, 3 h
  const OTHER = randomUUID(); // another business
  const OFFLINE = randomUUID(); // store switched off
  const OWNER = randomUUID();
  const tag = B.slice(0, 8);
  let seq = 0;

  const lines = (n = 2): CartLine[] =>
    Array.from({ length: n }, (_, i) => ({
      item_id: randomUUID(),
      variant_id: null,
      quantity: i + 1,
      price: 125,
      name: ['Basmati rice 5 kg', 'Ghee 1 L'][i] ?? `Thing ${i}`,
      image_url: null,
    }));
  async function shopper(business: string, name: string | null = 'Priya Sharma'): Promise<string> {
    const id = randomUUID();
    seq += 1;
    await pool.query(`INSERT INTO store_customers (id, business_id, phone, name) VALUES ($1, $2, $3, $4)`, [
      id,
      business,
      `97${String(Date.now()).slice(-6)}${String(seq).padStart(2, '0')}`,
      name,
    ]);
    return id;
  }
  async function abandoned(business: string, customer: string, ago: string): Promise<string> {
    await saveCart(business, customer, lines());
    const r = await pool.query(
      `UPDATE store_carts SET updated_at = now() - $3::interval WHERE business_id = $1 AND customer_id = $2 RETURNING id`,
      [business, customer, ago],
    );
    return r.rows[0].id;
  }
  const cartRow = async (id: string) => (await pool.query(`SELECT * FROM store_carts WHERE id = $1`, [id])).rows[0];
  const admin = (url: string, method: string, body?: unknown, businessId = B) =>
    new NextRequest(`http://localhost${url}`, {
      method,
      headers: {
        'content-type': 'application/json',
        'x-authenticated-user-id': OWNER,
        'x-authenticated-business-id': businessId,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  const cronReq = (bearer?: string) =>
    new NextRequest('http://localhost/api/cron/abandoned-carts', {
      headers: bearer ? { authorization: `Bearer ${bearer}` } : {},
    });
  const remindCart = (id: string, businessId = B) =>
    remind(admin(`/api/settings/online-store/abandoned-carts/${id}/remind`, 'POST', undefined, businessId), {
      params: { id },
    });

  beforeAll(async () => {
    pool = getPool();
    const db = (await pool.query(`SELECT current_database() AS db`)).rows[0].db;
    if (db !== TEST_DB) throw new Error(`Refusing: connected to ${db}`);
    await pool.query(
      `INSERT INTO businesses (id, name, gstin, state_code, gst_registration_type, phone)
       VALUES ($1, $2, $3, '27', 'regular', '9000000017'), ($4, $5, $6, '27', 'regular', '9000000018'),
              ($7, $8, $9, '27', 'regular', '9000000019')`,
      [
        B, `Route Traders ${tag}`, `27AABCR${tag.slice(0, 4).toUpperCase()}K1Z5`,
        OTHER, `Other Traders ${tag}`, `27AABCO${tag.slice(0, 4).toUpperCase()}K1Z5`,
        OFFLINE, `Dark Traders ${tag}`, `27AABCD${tag.slice(0, 4).toUpperCase()}K1Z5`,
      ],
    );
    await pool.query(
      `INSERT INTO business_settings (business_id, store_subdomain, store_enabled, store_cart_reminder_enabled, store_cart_reminder_hours)
       VALUES ($1, $2, true, true, 3), ($3, $4, true, true, 3), ($5, $6, false, true, 3)
       ON CONFLICT (business_id) DO UPDATE SET store_subdomain = EXCLUDED.store_subdomain,
         store_enabled = EXCLUDED.store_enabled,
         store_cart_reminder_enabled = EXCLUDED.store_cart_reminder_enabled,
         store_cart_reminder_hours = EXCLUDED.store_cart_reminder_hours`,
      [B, `rt-${tag}`, OTHER, `ro-${tag}`, OFFLINE, `rd-${tag}`],
    );
    await pool.query(
      `INSERT INTO users (id, business_id, name, phone, is_primary_admin, is_active) VALUES ($1, $2, 'Owner', $3, true, true)`,
      [OWNER, B, `96${String(Date.now()).slice(-8)}`],
    );
  });

  beforeEach(() => {
    mockPush.mockReset().mockResolvedValue({ queued: false, reason: 'no_device' });
    mockWa.mockReset().mockResolvedValue({ via: 'qr' });
  });

  afterAll(async () => {
    if (!pool) return;
    try {
      const c = await pool.connect();
      try {
        await c.query('BEGIN');
        await withLedgerDelete(c, 'tenant_purge', null, async () => {
          await c.query(`DELETE FROM store_carts WHERE business_id = ANY($1::uuid[])`, [[B, OTHER, OFFLINE]]);
          await c.query(`DELETE FROM businesses WHERE id = ANY($1::uuid[])`, [[B, OTHER, OFFLINE]]);
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

  test('cron rejects a missing or wrong bearer', async () => {
    expect((await cron(cronReq())).status).toBe(401);
    expect((await cron(cronReq('nope'))).status).toBe(401);
  });

  test('cron claims a due cart, sends one reminder and reports counts', async () => {
    const cart = await abandoned(B, await shopper(B), '5 hours');
    const res = await cron(cronReq('test-cron-secret'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      claimed: expect.any(Number),
      sent: expect.any(Number),
      failed: expect.any(Number),
      purged: expect.any(Number),
    });
    expect(body.claimed).toBeGreaterThanOrEqual(1);
    expect(body.sent + body.failed).toBe(body.claimed);
    expect(mockWa).toHaveBeenCalled();
    expect((await cartRow(cart)).reminder_via).toBe('whatsapp');
    // Nothing left: a second run claims none of ours.
    const again = await (await cron(cronReq('test-cron-secret'))).json();
    expect(again.sent).toBe(0);
  });

  test('cron counts a failed send and keeps going', async () => {
    mockWa.mockResolvedValue({ via: null });
    await abandoned(B, await shopper(B), '5 hours');
    const body = await (await cron(cronReq('test-cron-secret'))).json();
    expect(body.failed).toBeGreaterThanOrEqual(1);
    expect(body.sent).toBe(0);
  });

  test('list shows open carts of this business only, newest first, no recovered', async () => {
    const old = await abandoned(B, await shopper(B, 'Older'), '2 hours');
    const fresh = await abandoned(B, await shopper(B, null), '10 minutes');
    const recovered = await abandoned(B, await shopper(B), '1 hour');
    await pool.query(`UPDATE store_carts SET status = 'recovered' WHERE id = $1`, [recovered]);
    const foreign = await abandoned(OTHER, await shopper(OTHER), '1 hour');

    const res = await listCarts(admin('/api/settings/online-store/abandoned-carts', 'GET'));
    expect(res.status).toBe(200);
    const body = await res.json();
    const seen: string[] = body.carts.map((c: { id: string }) => c.id);
    expect(seen).toContain(old);
    expect(seen).toContain(fresh);
    expect(seen).not.toContain(recovered);
    expect(seen).not.toContain(foreign);
    expect(seen.indexOf(fresh)).toBeLessThan(seen.indexOf(old));
    const oldRow = body.carts.find((c: { id: string }) => c.id === old);
    expect(oldRow).toMatchObject({
      customer_name: 'Older',
      item_count: 3,
      subtotal: 375,
      reminded_at: null,
      reminder_via: null,
    });
    expect(oldRow.phone).toBeTruthy();
    expect(oldRow.lines).toHaveLength(2);
    expect(body.settings).toEqual({ enabled: true, hours: 3 });
  });

  test('list needs a session', async () => {
    const res = await listCarts(new NextRequest('http://localhost/api/settings/online-store/abandoned-carts'));
    expect(res.status).toBe(401);
  });

  test('list: no customers read permission is the helper 403', async () => {
    (authorize as jest.Mock).mockRejectedValueOnce(new AuthorizationError('No permission to read customers'));
    const res = await listCarts(admin('/api/settings/online-store/abandoned-carts', 'GET'));
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe('No permission to read customers');
  });

  test('list: a plan without the advanced online store is denied', async () => {
    const mockDeny = denyIfFeatureMissing as jest.Mock;
    mockDeny.mockResolvedValueOnce(NextResponse.json({ error: 'Upgrade required' }, { status: 403 }));
    const res = await listCarts(admin('/api/settings/online-store/abandoned-carts', 'GET'));
    expect(res.status).toBe(403);
    expect(mockDeny).toHaveBeenLastCalledWith(B, 'advanced_online_store');
  });

  test('remind sends once, the second click is 409', async () => {
    const cart = await abandoned(B, await shopper(B), '1 hour');
    const first = await remindCart(cart);
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({ sent: true, channel: 'whatsapp' });
    expect((await cartRow(cart)).reminder_via).toBe('manual');
    const second = await remindCart(cart);
    expect(second.status).toBe(409);
    expect(await second.json()).toEqual({ error: 'Reminder already sent in the last 24 hours' });
    expect(mockWa).toHaveBeenCalledTimes(1);
  });

  test('remind: malformed id and another business cart are 404', async () => {
    expect((await remindCart('not-a-uuid')).status).toBe(404);
    const foreign = await abandoned(OTHER, await shopper(OTHER), '1 hour');
    expect((await remindCart(foreign)).status).toBe(404);
    expect((await cartRow(foreign)).reminded_at).toBeNull();
    expect(mockWa).not.toHaveBeenCalled();
  });

  test('remind: a switched-off store is 400', async () => {
    const cart = await abandoned(OFFLINE, await shopper(OFFLINE), '1 hour');
    const res = await remindCart(cart, OFFLINE);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'Turn on your online store to send reminders.' });
    expect(mockWa).not.toHaveBeenCalled();
  });

  test('remind: a failed send is 502', async () => {
    mockWa.mockResolvedValue({ via: null });
    const cart = await abandoned(B, await shopper(B), '1 hour');
    const res = await remindCart(cart);
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: 'Could not send the reminder. Try again later.' });
  });

  test('settings round-trip the two reminder fields and clamp hours', async () => {
    const save = (b: Record<string, unknown>) => patchStore(admin('/api/settings/online-store', 'PATCH', b));
    const read = async () => (await getStore(admin('/api/settings/online-store', 'GET'))).json();
    expect((await save({ store_cart_reminder_enabled: false, store_cart_reminder_hours: 12 })).status).toBe(200);
    expect(await read()).toMatchObject({ store_cart_reminder_enabled: false, store_cart_reminder_hours: 12 });
    await save({ store_cart_reminder_enabled: true, store_cart_reminder_hours: 0 });
    expect(await read()).toMatchObject({ store_cart_reminder_enabled: true, store_cart_reminder_hours: 1 });
    await save({ store_cart_reminder_hours: 99 });
    expect((await read()).store_cart_reminder_hours).toBe(72);
  });
});
