/**
 * Online-store settings API (web page and phone app) reads and saves its Shiprocket fields through the
 * integrations service. Real PostgreSQL; the Shiprocket login check is stubbed.
 * Runs only when PHASE2_TEST_DATABASE_URL points at a disposable database.
 */
import { randomUUID } from 'crypto';
import type { Pool } from 'pg';
import { NextRequest } from 'next/server';

const url = process.env.PHASE2_TEST_DATABASE_URL;
if (url) process.env.DATABASE_URL = url;
if (!process.env.PAYMENT_ENCRYPTION_KEY) process.env.PAYMENT_ENCRYPTION_KEY = '0123456789abcdef'.repeat(4);
const d = url ? describe : describe.skip;

const mockVerify = jest.fn();
jest.mock('@/lib/integrations/providers', () => ({
  getProvider: () => ({
    verify: (...a: unknown[]) => mockVerify(...a),
    countInFlight: async () => 0,
  }),
}));
jest.mock('@/lib/queue/redis', () => ({ getRedisConnection: () => null }));
jest.mock('@/lib/rag/tenant-reindex', () => ({ noteShopChanged: jest.fn() }));
jest.mock('@/lib/subscription/feature-access', () => ({
  denyIfFeatureMissing: jest.fn().mockResolvedValue(null),
}));
jest.mock('@/lib/security/require-tenant-permission', () => ({
  requireTenantPermission: jest.fn(async (req: NextRequest) => ({
    ok: true,
    businessId: req.headers.get('x-authenticated-business-id'),
    userId: req.headers.get('x-authenticated-user-id'),
  })),
}));

import { getPool, closePool } from '@/lib/db';
import { GET, PATCH } from '@/app/api/settings/online-store/route';
import { getConnection, saveConnection, loadSecrets } from '@/lib/integrations/service';

const ACCEPT = { ok: true };
const REJECT = { ok: false, reason: 'rejected', message: 'Shiprocket did not accept this email and password.' };

d('online-store settings: Shiprocket via integrations (real DB)', () => {
  jest.setTimeout(60000);

  let pool: Pool;
  const USER = randomUUID();
  const tag = randomUUID().slice(0, 8);
  const biz = {
    reject: randomUUID(),
    plain: randomUUID(),
    tokenOnly: randomUUID(),
    provider: randomUUID(),
    stale: randomUUID(),
    blank: randomUUID(),
  };
  const ALL = Object.values(biz);

  const call = (business: string, method: 'GET' | 'PATCH', body?: Record<string, unknown>) =>
    new NextRequest('http://localhost/api/settings/online-store', {
      method,
      headers: {
        'content-type': 'application/json',
        'x-authenticated-user-id': USER,
        'x-authenticated-business-id': business,
      },
      body: body ? JSON.stringify(body) : undefined,
    });

  const settings = async (business: string) =>
    (await pool.query(`SELECT * FROM business_settings WHERE business_id = $1`, [business])).rows[0];

  beforeAll(async () => {
    pool = getPool();
    const db = await pool.query<{ db: string }>('SELECT current_database() AS db');
    if (!/test/i.test(db.rows[0].db)) throw new Error(`Refusing to run against ${db.rows[0].db}`);
    for (const [name, id] of Object.entries(biz)) {
      await pool.query(
        `INSERT INTO businesses (id, name, gstin, state_code, gst_registration_type)
         VALUES ($1, $2, '27AAAPA1234A1Z5', '27', 'regular')`,
        [id, `OS Shiprocket ${name} ${tag}`],
      );
      await pool.query(`INSERT INTO business_settings (business_id) VALUES ($1) ON CONFLICT (business_id) DO NOTHING`, [id]);
    }
  });

  beforeEach(() => {
    mockVerify.mockReset();
    mockVerify.mockResolvedValue(ACCEPT);
  });

  afterAll(async () => {
    if (!pool) return;
    try {
      await pool.query(`DELETE FROM business_integrations WHERE business_id = ANY($1::uuid[])`, [ALL]);
      await pool.query(`DELETE FROM business_settings WHERE business_id = ANY($1::uuid[])`, [ALL]);
      await pool.query(`DELETE FROM businesses WHERE id = ANY($1::uuid[])`, [ALL]);
    } finally {
      await closePool();
    }
  });

  test('GET reports the connection', async () => {
    const empty = await (await GET(call(biz.plain, 'GET'))).json();
    expect(empty.store_shiprocket_email).toBeNull();
    expect(empty.shiprocket_configured).toBe(false);
    expect(empty.shiprocket_webhook_configured).toBe(false);

    const saved = await saveConnection(biz.plain, 'shiprocket', { email: 'api@shop.test', password: 'pw-1' }, USER);
    expect(saved.ok).toBe(true);
    const body = await (await GET(call(biz.plain, 'GET'))).json();
    expect(body.store_shiprocket_email).toBe('api@shop.test');
    expect(body.shiprocket_configured).toBe(true);
    expect(body.shiprocket_webhook_configured).toBe(false);
    expect(JSON.stringify(body)).not.toContain('pw-1');
  });

  test('PATCH with email + password goes through the credential check; a rejection saves nothing', async () => {
    mockVerify.mockResolvedValue(REJECT);
    const res = await PATCH(
      call(biz.reject, 'PATCH', { store_tagline: 'should not stick', store_shiprocket_email: 'x@shop.test', store_shiprocket_password: 'bad' }),
    );
    expect(res.status).toBe(400);
    expect(mockVerify).toHaveBeenCalledTimes(1);
    expect(await getConnection(biz.reject, 'shiprocket')).toBeNull();
    expect((await settings(biz.reject)).store_tagline).toBeNull();
  });

  test('PATCH with email + password stores the connection, not the old columns', async () => {
    const res = await PATCH(
      call(biz.plain, 'PATCH', { store_tagline: 'hello', store_shiprocket_email: 'new@shop.test', store_shiprocket_password: 'pw-2' }),
    );
    expect(res.status).toBe(200);
    expect(mockVerify).toHaveBeenCalledTimes(1);
    expect((await loadSecrets(biz.plain, 'shiprocket'))?.secrets.password).toBe('pw-2');
    expect((await getConnection(biz.plain, 'shiprocket'))?.config.email).toBe('new@shop.test');
    const row = await settings(biz.plain);
    expect(row.store_tagline).toBe('hello');
    expect(row.store_shiprocket_email).toBeNull();
    expect(row.store_shiprocket_password_enc).toBeNull();
    expect(row.store_shiprocket_webhook_token_hash).toBeNull();
  });

  test('PATCH with only store_tagline does not call verify', async () => {
    const res = await PATCH(call(biz.plain, 'PATCH', { store_tagline: 'only tagline' }));
    expect(res.status).toBe(200);
    expect(mockVerify).not.toHaveBeenCalled();
  });

  test('R2: a blank password keeps the stored one', async () => {
    await saveConnection(biz.blank, 'shiprocket', { email: 'keep@shop.test', password: 'secret-keep' }, USER);
    const res = await PATCH(
      call(biz.blank, 'PATCH', { store_shiprocket_email: 'keep2@shop.test', store_shiprocket_password: '' }),
    );
    expect(res.status).toBe(200);
    const s = await loadSecrets(biz.blank, 'shiprocket');
    expect(s?.secrets.password).toBe('secret-keep');
    expect(s?.config.email).toBe('keep2@shop.test');
  });

  test('PATCH with only a webhook token and no connection is 400', async () => {
    const res = await PATCH(call(biz.tokenOnly, 'PATCH', { store_shiprocket_webhook_token: `tok${tag}${'z'.repeat(24)}` }));
    expect(res.status).toBe(400);
    expect(mockVerify).not.toHaveBeenCalled();
  });

  test('PATCH with only a webhook token on a connected business sets it', async () => {
    const res = await PATCH(call(biz.plain, 'PATCH', { store_shiprocket_webhook_token: `tok${tag}${'y'.repeat(24)}` }));
    expect(res.status).toBe(200);
    expect(mockVerify).not.toHaveBeenCalled();
    const body = await (await GET(call(biz.plain, 'GET'))).json();
    expect(body.shiprocket_webhook_configured).toBe(true);
  });

  test('choosing shiprocket as the checkout provider without a connection is 400', async () => {
    const res = await PATCH(call(biz.provider, 'PATCH', { store_delivery_provider: 'shiprocket' }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('Connect Shiprocket under Integrations first');
    expect((await settings(biz.provider)).store_delivery_provider ?? 'self').not.toBe('shiprocket');
  });

  test('choosing shiprocket in the same PATCH that connects it is accepted', async () => {
    const res = await PATCH(
      call(biz.provider, 'PATCH', {
        store_delivery_provider: 'shiprocket',
        store_shiprocket_email: 'p@shop.test',
        store_shiprocket_password: 'pw-p',
      }),
    );
    expect(res.status).toBe(200);
    expect((await settings(biz.provider)).store_delivery_provider).toBe('shiprocket');
  });

  test('R3: re-sending the already-stored shiprocket with no connection is accepted', async () => {
    await pool.query(`UPDATE business_settings SET store_delivery_provider = 'shiprocket' WHERE business_id = $1`, [biz.stale]);
    const res = await PATCH(call(biz.stale, 'PATCH', { store_delivery_provider: 'shiprocket', store_tagline: 'stale ok' }));
    expect(res.status).toBe(200);
    expect((await settings(biz.stale)).store_tagline).toBe('stale ok');
  });
});
