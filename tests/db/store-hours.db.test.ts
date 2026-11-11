/**
 * Store hours (business_settings.store_hours, migration 463) against real PostgreSQL: the online-store
 * settings PATCH saves the sanitised value, GET returns it, and the storefront context reads it.
 * Runs only when PHASE2_TEST_DATABASE_URL points at a disposable database with migration 463 applied.
 */
import { randomUUID } from 'crypto';
import type { Pool } from 'pg';
import { NextRequest } from 'next/server';

const url = process.env.PHASE2_TEST_DATABASE_URL;
if (url) process.env.DATABASE_URL = url;
const d = url ? describe : describe.skip;

jest.mock('@/lib/queue/redis', () => ({ getRedisConnection: () => null }));
jest.mock('@/lib/rag/tenant-reindex', () => ({ noteShopChanged: jest.fn() }));
jest.mock('@/lib/jwt', () => ({ clearSessionCookie: jest.fn() }));
// The test business has no plan or roles: let the plan and permission checks pass.
jest.mock('@/lib/authorization', () => ({
  ...jest.requireActual('@/lib/authorization'),
  authorize: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('@/lib/subscription/feature-access', () => ({
  ...jest.requireActual('@/lib/subscription/feature-access'),
  hasFeatureAccess: jest.fn().mockResolvedValue(true),
  denyIfFeatureMissing: jest.fn().mockResolvedValue(null),
}));

import { getPool, closePool } from '@/lib/db';
import { GET as getStore, PATCH as patchStore } from '@/app/api/settings/online-store/route';
import { resolveStoreBySubdomain } from '@/lib/store/resolve-store';

d('Store hours (real DB)', () => {
  jest.setTimeout(60000);

  let pool: Pool;
  const BIZ = randomUUID();
  const OWNER = randomUUID();
  const SUB = `hours-${BIZ.slice(0, 8)}`;

  const call = (method: 'GET' | 'PATCH', body?: Record<string, unknown>) =>
    new NextRequest('http://localhost/api/settings/online-store', {
      method,
      headers: {
        'content-type': 'application/json',
        'x-authenticated-user-id': OWNER,
        'x-authenticated-business-id': BIZ,
      },
      body: body ? JSON.stringify(body) : undefined,
    });

  beforeAll(async () => {
    pool = getPool();
    await pool.query(
      `INSERT INTO businesses (id, name, gstin, state_code, gst_registration_type) VALUES ($1, 'Store hours test', '29AAAPA1234A1Z5', '29', 'regular')`,
      [BIZ],
    );
    await pool.query(
      `INSERT INTO business_settings (business_id, store_subdomain, store_enabled) VALUES ($1, $2, true)`,
      [BIZ, SUB],
    );
  });

  afterAll(async () => {
    if (!pool) return;
    await pool.query(`DELETE FROM business_settings WHERE business_id = $1`, [BIZ]);
    await pool.query(`DELETE FROM businesses WHERE id = $1`, [BIZ]);
    await closePool();
  });

  it('saves and reads store_hours', async () => {
    const col = await pool.query(
      `SELECT data_type FROM information_schema.columns WHERE table_name = 'business_settings' AND column_name = 'store_hours'`,
    );
    expect(col.rows[0]?.data_type).toBe('jsonb');

    // Unset: null everywhere.
    expect((await (await getStore(call('GET'))).json()).store_hours).toBeNull();
    expect((await resolveStoreBySubdomain(SUB))?.store_hours).toBeNull();

    const res = await patchStore(
      call('PATCH', {
        store_hours: {
          mon: { open: '07:00', close: '22:00' },
          tue: { open: '22:00', close: '07:00' }, // close not after open: closed
          wed: { open: '7:00', close: '22:00' }, // no leading zero: closed
          sat: { open: '09:30', close: '21:30' },
          holiday: { open: '07:00', close: '22:00' }, // unknown key: dropped
        },
      }),
    );
    expect(res.status).toBe(200);

    const expected = {
      mon: { open: '07:00', close: '22:00' },
      tue: null,
      wed: null,
      thu: null,
      fri: null,
      sat: { open: '09:30', close: '21:30' },
      sun: null,
    };
    const raw = await pool.query(`SELECT store_hours FROM business_settings WHERE business_id = $1`, [BIZ]);
    expect(raw.rows[0].store_hours).toEqual(expected);
    expect((await (await getStore(call('GET'))).json()).store_hours).toEqual(expected);
    expect((await resolveStoreBySubdomain(SUB))?.store_hours).toEqual(expected);

    // Nothing valid (or null) clears the hours to SQL NULL.
    expect((await patchStore(call('PATCH', { store_hours: { mon: null } }))).status).toBe(200);
    const cleared = await pool.query(
      `SELECT store_hours IS NULL AS is_null FROM business_settings WHERE business_id = $1`,
      [BIZ],
    );
    expect(cleared.rows[0].is_null).toBe(true);
    expect((await resolveStoreBySubdomain(SUB))?.store_hours).toBeNull();
  });
});
