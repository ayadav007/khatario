/**
 * Real-PostgreSQL test: createCustomer, the service behind POST /api/customers and the import.
 * Runs only when PHASE2_TEST_DATABASE_URL points at a disposable database.
 * Creates its own business and removes only that.
 */
import { randomUUID } from 'crypto';
import type { Pool } from 'pg';

const url = process.env.PHASE2_TEST_DATABASE_URL;
if (url) process.env.DATABASE_URL = url;
const d = url ? describe : describe.skip;

// enforceAccess reads the request headers; outside a route the test supplies the session ones.
const headerBag: { current: Record<string, string> } = { current: {} };
(global as unknown as { __csHeaders: typeof headerBag }).__csHeaders = headerBag;

jest.mock('next/headers', () => ({
  headers: jest.fn(async () => ({
    get: (name: string) =>
      (global as unknown as { __csHeaders: { current: Record<string, string> } }).__csHeaders.current[
        name.toLowerCase()
      ] ?? null,
  })),
  cookies: jest.fn(async () => ({ get: () => undefined })),
}));

jest.mock('@/lib/jwt', () => ({
  clearSessionCookie: jest.fn(),
  shouldRotateTokens: jest.fn(async () => ({ rotate: false, payload: null })),
}));
jest.mock('@/lib/platform-jwt', () => ({ getPlatformSessionFromRequest: jest.fn(async () => null) }));

import { getPool, closePool } from '@/lib/db';
import { withLedgerDelete } from '@/lib/accounting/ledger-delete-guard';
import { createCustomer } from '@/lib/customers/create-customer';

d('createCustomer (real DB)', () => {
  jest.setTimeout(60000);

  let pool: Pool;
  const B = randomUUID();
  const BR = randomUUID();
  const U = randomUUID();
  const tag = B.slice(0, 8);
  const ctx = { businessId: B, userId: U };

  const count = async (table: 'customers') =>
    Number((await pool.query(`SELECT COUNT(*)::int AS n FROM ${table} WHERE business_id = $1`, [B])).rows[0].n);

  beforeAll(async () => {
    pool = getPool();
    const plan = await pool.query<{ plan_id: string }>(
      `SELECT plan_id FROM subscription_plan_features
        WHERE enabled = true AND feature_id IN ('accounting_chart', 'advanced_ledger', 'reports_advanced')
        GROUP BY plan_id HAVING COUNT(DISTINCT feature_id) = 3 LIMIT 1`
    );
    if (!plan.rows[0]) throw new Error('No plan grants accounting_chart, advanced_ledger, and reports_advanced');
    const orphans = await pool.query<{ id: string }>(`SELECT id FROM businesses WHERE name LIKE 'Cust svc %'`);
    if (orphans.rows.length) await purge(orphans.rows.map((row) => row.id));
    await pool.query(
      `INSERT INTO businesses (id, name, gstin, state_code, gst_registration_type, primary_module)
       VALUES ($1, $2, '27AAAPA1234A1Z5', '27', 'regular', 'billing')`,
      [B, `Cust svc ${tag}`]
    );
    await pool.query(
      `INSERT INTO business_modules (business_id, module_key, enabled, source) VALUES ($1, 'billing', true, 'test')`,
      [B]
    );
    await pool.query(
      `INSERT INTO business_module_subscriptions (business_id, module_key, plan_id, status, start_date, end_date)
       VALUES ($1, 'billing', $2, 'active', CURRENT_DATE, CURRENT_DATE + 30)`,
      [B, plan.rows[0].plan_id]
    );
    await pool.query(
      `INSERT INTO branches (id, business_id, name, state_code, is_primary, is_default, is_active)
       VALUES ($1, $2, 'Main', '27', true, true, true)`,
      [BR, B]
    );
    await pool.query(
      `INSERT INTO users (id, business_id, name, phone, is_primary_admin, auth_session_version, is_active)
       VALUES ($1, $2, 'Admin', $3, true, 1, true)`,
      [U, B, `94${Date.now().toString().slice(-8)}`]
    );
    headerBag.current = {
      'x-authenticated-user-id': U,
      'x-authenticated-business-id': B,
      'x-authenticated-session-version': '1',
    };
  });

  async function purge(businessIds: string[]) {
    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      await withLedgerDelete(c, 'admin:seed_demo', null, async () => {
        await c.query(`DELETE FROM ledger_entry_lines WHERE business_id = ANY($1::uuid[])`, [businessIds]);
        await c.query(`DELETE FROM ledger_entries WHERE business_id = ANY($1::uuid[])`, [businessIds]);
      });
      for (const id of businessIds) {
        await c.query(`DELETE FROM customers WHERE business_id = $1`, [id]);
        await c.query(`DELETE FROM activity_logs WHERE business_id = $1`, [id]);
        await c.query(`DELETE FROM user_branches WHERE user_id IN (SELECT id FROM users WHERE business_id = $1)`, [id]);
        await c.query(`DELETE FROM branches WHERE business_id = $1`, [id]);
        await c.query(`DELETE FROM users WHERE business_id = $1`, [id]);
        await c.query(`DELETE FROM business_module_subscriptions WHERE business_id = $1`, [id]);
        await c.query(`DELETE FROM business_modules WHERE business_id = $1`, [id]);
        await c.query(`DELETE FROM businesses WHERE id = $1`, [id]);
      }
      await c.query('COMMIT');
    } catch (e) {
      await c.query('ROLLBACK').catch(() => {});
      throw e;
    } finally {
      c.release();
    }
  }

  afterAll(async () => {
    try {
      if (pool) await purge([B]);
    } finally {
      await closePool();
    }
  });

  test('createCustomer inserts and returns the row', async () => {
    // 27AAAPA1234A1Z5 (the seeded business's GSTIN) fails the check character; T is the valid one.
    const r = await createCustomer(ctx, { name: 'Sharma Traders', phone: '9876543210', gstin: '27AAAPA1234A1ZT' });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.record.state_code).toBe('27');
      expect(r.record.business_id).toBe(B);
    }
  });

  test('duplicate phone returns the existing customer, creates nothing', async () => {
    const r = await createCustomer(ctx, { name: 'Other', phone: '9876543210' });
    expect(r).toMatchObject({ ok: false, status: 200, code: 'DUPLICATE_PHONE' });
    if (!r.ok) expect(r.existing?.name).toBe('Sharma Traders');
    expect(await count('customers')).toBe(1);
  });

  test('invalid GSTIN is refused', async () => {
    expect(await createCustomer(ctx, { name: 'X', gstin: '27BAD' })).toMatchObject({ ok: false, status: 400 });
    expect(await count('customers')).toBe(1);
  });

  test('a state name with no GSTIN gets its state code', async () => {
    const r = await createCustomer(ctx, { name: 'Rao Stores', state: 'Karnataka' });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.record.state_code).toBe('29');
  });
});
