/**
 * Real-PostgreSQL test for POST /api/businesses/switch and migration 466.
 *
 * Migration 208 backfilled every existing user, staff included, as an `owner` member of their
 * business. The switch route must never raise a user's role on the strength of that membership
 * row: only a user the business itself recognises as its owner (is_primary_admin) may receive
 * the primary_admin role when switching, and migration 466 corrects the backfilled rows.
 *
 * Runs only when KH_SECURITY_TEST_DATABASE_URL points at a disposable database; each run works
 * in its own schema and drops it afterwards.
 */
import fs from 'fs';
import path from 'path';
import { Pool } from 'pg';
import { NextRequest } from 'next/server';

const url = process.env.KH_SECURITY_TEST_DATABASE_URL;
const d = url ? describe : describe.skip;

const schema = `biz_switch_${process.pid}_${Date.now()}`;
if (url) {
  // lib/db builds its pool from DATABASE_URL on first use; point it at this run's schema.
  process.env.DATABASE_URL = `${url}${url.includes('?') ? '&' : '?'}options=${encodeURIComponent(`-c search_path=${schema},public`)}`;
}

jest.mock('@/lib/jwt', () => ({
  clearSessionCookie: jest.fn(),
  signAccessToken: jest.fn(async () => 'access'),
  signRefreshToken: jest.fn(async () => 'refresh'),
  setSessionCookies: jest.fn(),
}));

const BIZ = '00000000-0000-4000-8000-0000000000b1';
const BIZ2 = '00000000-0000-4000-8000-0000000000b2';
const OWNER = '00000000-0000-4000-8000-0000000000a1';
const STAFF = '00000000-0000-4000-8000-0000000000a2';
const ADMIN_ROLE = '00000000-0000-4000-8000-0000000000e1';
const SALES_ROLE = '00000000-0000-4000-8000-0000000000e2';
const ADMIN_ROLE_2 = '00000000-0000-4000-8000-0000000000e3';

const baseSql = fs.readFileSync(path.join(__dirname, 'fixtures/business-switch-base-schema.sql'), 'utf8');
const backfillSql = fs.readFileSync(path.join(__dirname, '../../database/migrations/208_user_businesses.sql'), 'utf8');
const fixSqlPath = path.join(__dirname, '../../database/migrations/466_user_businesses_role_from_primary_admin.sql');

d('business switch does not grant admin from the membership backfill (real DB)', () => {
  let admin: Pool;
  let pool: Pool;

  function switchAs(userId: string, businessId: string) {
    return new NextRequest('http://localhost/api/businesses/switch', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-authenticated-user-id': userId,
        'x-authenticated-business-id': businessId,
        'x-authenticated-session-version': '1',
      },
      body: JSON.stringify({ business_id: businessId }),
    });
  }

  const roleOf = async (userId: string) =>
    (await pool.query<{ role_id: string | null }>('SELECT role_id FROM users WHERE id = $1', [userId])).rows[0].role_id;

  beforeAll(async () => {
    admin = new Pool({ connectionString: url, max: 1 });
    await admin.query(`CREATE SCHEMA ${schema}`);
    pool = new Pool({ connectionString: url, max: 4, options: `-c search_path=${schema},public` });
    await pool.query(baseSql);

    await pool.query(`INSERT INTO businesses (id, name) VALUES ($1, 'Shop'), ($2, 'Second shop')`, [BIZ, BIZ2]);
    await pool.query(
      `INSERT INTO user_roles (id, business_id, role_name, role_key, is_system_role)
       VALUES ($1, $4, 'Primary Admin', 'primary_admin', true),
              ($2, $4, 'Sales', 'sales', false),
              ($3, $5, 'Primary Admin', 'primary_admin', true)`,
      [ADMIN_ROLE, SALES_ROLE, ADMIN_ROLE_2, BIZ, BIZ2],
    );
    // The owner signed up (is_primary_admin); the staff member was added later with the Sales role.
    await pool.query(
      `INSERT INTO users (id, business_id, role_id, is_primary_admin)
       VALUES ($1, $3, $4, true), ($2, $3, $5, false)`,
      [OWNER, STAFF, BIZ, ADMIN_ROLE, SALES_ROLE],
    );
    // Migration 208 as shipped: everyone becomes an 'owner' member of their business.
    await pool.query(backfillSql.replace(/CREATE TABLE IF NOT EXISTS user_businesses[\s\S]*?\);/, ''));
    // The owner also owns a second business (the add-business flow inserts 'owner').
    await pool.query(`INSERT INTO user_businesses (user_id, business_id, role) VALUES ($1, $2, 'owner')`, [OWNER, BIZ2]);
  }, 30000);

  afterAll(async () => {
    const { getPool } = await import('@/lib/db');
    await getPool().end().catch(() => {});
    await pool?.end();
    if (admin) {
      await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
      await admin.end();
    }
  });

  it('the backfill left the staff member marked as an owner', async () => {
    const row = await pool.query<{ role: string }>('SELECT role FROM user_businesses WHERE user_id = $1', [STAFF]);
    expect(row.rows[0].role).toBe('owner');
  });

  it('a staff member switching to their own business keeps their staff role', async () => {
    const { POST } = await import('@/app/api/businesses/switch/route');
    const res = await POST(switchAs(STAFF, BIZ));
    expect(res.status).toBe(200);
    expect(await roleOf(STAFF)).toBe(SALES_ROLE);
  });

  it('the real owner switching to a business they own receives that business’s primary admin role', async () => {
    const { POST } = await import('@/app/api/businesses/switch/route');
    const res = await POST(switchAs(OWNER, BIZ2));
    expect(res.status).toBe(200);
    expect(await roleOf(OWNER)).toBe(ADMIN_ROLE_2);
    const back = await POST(switchAs(OWNER, BIZ));
    expect(back.status).toBe(200);
    expect(await roleOf(OWNER)).toBe(ADMIN_ROLE);
  });

  it('a non-member is refused and nothing changes', async () => {
    const { POST } = await import('@/app/api/businesses/switch/route');
    const res = await POST(switchAs(STAFF, BIZ2));
    expect(res.status).toBe(403);
    expect(await roleOf(STAFF)).toBe(SALES_ROLE);
    const biz = await pool.query<{ business_id: string }>('SELECT business_id FROM users WHERE id = $1', [STAFF]);
    expect(biz.rows[0].business_id).toBe(BIZ);
  });

  it('migration 466 demotes backfilled staff memberships and keeps real owners', async () => {
    expect(fs.existsSync(fixSqlPath)).toBe(true);
    const fixSql = fs.readFileSync(fixSqlPath, 'utf8');
    await pool.query(fixSql);
    const rows = await pool.query<{ user_id: string; business_id: string; role: string }>(
      'SELECT user_id, business_id, role FROM user_businesses ORDER BY user_id, business_id',
    );
    expect(rows.rows).toEqual([
      { user_id: OWNER, business_id: BIZ, role: 'owner' },
      { user_id: OWNER, business_id: BIZ2, role: 'owner' },
      { user_id: STAFF, business_id: BIZ, role: 'staff' },
    ]);
    // Re-running is harmless.
    await pool.query(fixSql);
  });
});
