/**
 * Quick theme data against real PostgreSQL: the free-delivery threshold on store branches and the
 * coupons listed as cart offers (only active, unexpired, under-cap ones the merchant marked "show in store").
 * Runs only when PHASE2_TEST_DATABASE_URL points at a disposable database with migration 441 applied.
 */
import { randomUUID } from 'crypto';
import type { Pool } from 'pg';
import { NextRequest } from 'next/server';

const url = process.env.PHASE2_TEST_DATABASE_URL;
if (url) process.env.DATABASE_URL = url;
const d = url ? describe : describe.skip;

jest.mock('@/lib/queue/redis', () => ({ getRedisConnection: () => null }));
// A fresh test business has no plan; the online-store gate is not what this test is about.
jest.mock('@/lib/subscription/feature-access', () => ({
  ...jest.requireActual('@/lib/subscription/feature-access'),
  hasFeatureAccess: jest.fn(async () => true),
}));

import { getPool, closePool } from '@/lib/db';
import { getStoreBranches } from '@/lib/store/resolve-store';

d('Quick theme store data (real DB)', () => {
  jest.setTimeout(60000);

  let pool: Pool;
  const BIZ = randomUUID();
  const SAME = randomUUID();
  const MIXED = randomUUID();
  const NONE = randomUUID();
  const SUB = `qk${Date.now().toString(36)}`;

  async function branch(id: string, name: string, thresholds: Array<number | null>) {
    await pool.query(`INSERT INTO branches (id, business_id, name, state_code, is_default, is_active) VALUES ($1, $2, $3, '29', false, true)`, [
      id,
      BIZ,
      name,
    ]);
    const sbd = randomUUID();
    await pool.query(`INSERT INTO store_branch_delivery (id, business_id, branch_id) VALUES ($1, $2, $3)`, [sbd, BIZ, id]);
    for (const [i, free] of thresholds.entries()) {
      await pool.query(
        `INSERT INTO store_delivery_charges (branch_delivery_id, min_distance_km, max_distance_km, charge, free_above_amount, sort_order)
         VALUES ($1, $2, $3, 30, $4, $5)`,
        [sbd, i * 5, i * 5 + 5, free, i],
      );
    }
  }

  beforeAll(async () => {
    pool = getPool();
    await pool.query(
      `INSERT INTO businesses (id, name, gstin, state_code, gst_registration_type) VALUES ($1, 'Quick test', '29AAAPA1234A1Z5', '29', 'regular')`,
      [BIZ],
    );
    await pool.query(
      `INSERT INTO business_settings (business_id, store_subdomain, store_enabled) VALUES ($1, $2, true)
       ON CONFLICT (business_id) DO UPDATE SET store_subdomain = EXCLUDED.store_subdomain, store_enabled = true`,
      [BIZ, SUB],
    );
    await branch(SAME, 'A Same', [499, 499]);
    await branch(MIXED, 'B Mixed', [499, 799]);
    await branch(NONE, 'C None', [499, null]);
    const coupons: Array<[string, boolean, boolean, string | null, number | null, number]> = [
      ['SHOWN', true, true, null, null, 0],
      ['HIDDEN', true, false, null, null, 0],
      ['OFF', false, true, null, null, 0],
      ['EXPIRED', true, true, '2020-01-01', null, 0],
      ['USEDUP', true, true, null, 5, 5],
    ];
    for (const [code, active, show, expires, cap, used] of coupons) {
      await pool.query(
        `INSERT INTO store_coupons (business_id, code, discount_type, discount_value, min_order_amount, is_active, show_in_store, expires_at, usage_cap, used_count)
         VALUES ($1, $2, 'flat', 50, 199, $3, $4, $5, $6, $7)`,
        [BIZ, code, active, show, expires, cap, used],
      );
    }
  });

  afterAll(async () => {
    if (!pool) return;
    await pool.query(`DELETE FROM store_coupons WHERE business_id = $1`, [BIZ]);
    await pool.query(`DELETE FROM store_branch_delivery WHERE business_id = $1`, [BIZ]);
    await pool.query(`DELETE FROM branches WHERE business_id = $1`, [BIZ]);
    await pool.query(`DELETE FROM business_settings WHERE business_id = $1`, [BIZ]);
    await pool.query(`DELETE FROM businesses WHERE id = $1`, [BIZ]);
    await closePool();
  });

  it('gives a free-delivery threshold only when every delivery slab agrees', async () => {
    const branches = await getStoreBranches(BIZ);
    expect(branches.map((b) => [b.name, b.free_delivery_above])).toEqual([
      ['A Same', 499],
      ['B Mixed', null],
      ['C None', null],
    ]);
  });

  it('lists only usable coupons the merchant chose to show', async () => {
    const { GET } = await import('@/app/api/public/store/[subdomain]/offers/route');
    const res = await GET(new NextRequest(`http://localhost/api/public/store/${SUB}/offers`), { params: { subdomain: SUB } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.coupons).toEqual([{ code: 'SHOWN', discount_type: 'flat', discount_value: 50, min_order_amount: 199 }]);
  });
});
