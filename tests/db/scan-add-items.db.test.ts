/**
 * Scan & Add Items: retry-safe item create and the shop barcode check.
 * Writes only after current_database() is kh_phase2_test on port 5433.
 */
import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import type { Pool } from 'pg';
import { NextRequest } from 'next/server';

function readEnvFile(file: string): Record<string, string> {
  const text = fs.readFileSync(file, 'utf8');
  const out: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!match) continue;
    let val = match[2].trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1);
    out[match[1]] = val;
  }
  return out;
}

function forceDisposableDatabase(): void {
  const env = readEnvFile(path.resolve(process.cwd(), '.env'));
  const host = env.DB_HOST || '';
  if (host !== 'localhost' && host !== '127.0.0.1' && host !== '::1') {
    throw new Error('Refusing scan & add tests: database host is not local');
  }
  const port = env.DB_PORT || '5432';
  process.env.DATABASE_URL = `postgresql://${encodeURIComponent(env.DB_USER)}:${encodeURIComponent(env.DB_PASSWORD)}@${host}:${port}/kh_phase2_test`;
  process.env.DB_NAME = 'kh_phase2_test';
}

forceDisposableDatabase();

jest.mock('next/headers', () => ({
  headers: jest.fn(async () => ({ get: () => null })),
  cookies: jest.fn(async () => ({ get: () => undefined })),
}));
jest.mock('@/lib/jwt', () => ({ clearSessionCookie: jest.fn() }));
jest.mock('@/lib/authorization', () => ({
  ...jest.requireActual('@/lib/authorization'),
  authorize: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('@/lib/rag/tenant-reindex', () => ({ noteShopChanged: jest.fn() }));

import { getPool, closePool } from '@/lib/db';
import { withLedgerDelete } from '@/lib/accounting/ledger-delete-guard';
import { POST as postItem } from '@/app/api/items/route';
import { GET as getBarcode } from '@/app/api/items/scan-add/barcode/route';

describe('scan & add items', () => {
  jest.setTimeout(120000);
  let pool: Pool;
  const B = randomUUID();
  const OTHER = randomUUID();
  const BR = randomUUID();
  const OBR = randomUUID();
  const USER = randomUUID();
  const OUSER = randomUUID();
  const tag = B.slice(0, 8);
  const auth = (userId: string, businessId: string) => ({
    'content-type': 'application/json',
    'x-authenticated-user-id': userId,
    'x-authenticated-business-id': businessId,
    'x-authenticated-session-version': '1',
  });

  async function create(body: Record<string, unknown>, key?: string, as: [string, string] = [USER, B]) {
    const res = await postItem(
      new NextRequest('http://localhost/api/items', {
        method: 'POST',
        headers: { ...auth(as[0], as[1]), ...(key ? { 'x-idempotency-key': key } : {}) },
        body: JSON.stringify(body),
      })
    );
    return { status: res.status, json: await res.json() };
  }

  async function lookup(code: string, as: [string, string] = [USER, B]) {
    const res = await getBarcode(
      new NextRequest(`http://localhost/api/items/scan-add/barcode?code=${encodeURIComponent(code)}`, {
        headers: auth(as[0], as[1]),
      })
    );
    return { status: res.status, json: await res.json() };
  }

  async function stockFacts(itemId: string) {
    const r = await pool.query(
      `SELECT
         (SELECT COUNT(*)::int FROM items WHERE business_id = $2 AND name = (SELECT name FROM items WHERE id = $1)) AS items,
         (SELECT COUNT(*)::int FROM stock_movements WHERE item_id = $1) AS movements,
         (SELECT COALESCE(SUM(quantity), 0)::numeric FROM stock_movements WHERE item_id = $1) AS moved,
         (SELECT current_stock FROM items WHERE id = $1) AS current_stock,
         (SELECT COALESCE(SUM(debit), 0)::numeric FROM ledger_entry_lines
           WHERE business_id = $2 AND voucher_id = $1 AND voucher_type = 'opening_stock') AS opening_value`,
      [itemId, B]
    );
    return r.rows[0];
  }

  beforeAll(async () => {
    pool = getPool();
    const db = await pool.query<{ db: string; addr: string; port: number }>(
      `SELECT current_database() AS db, inet_server_addr()::text AS addr, inet_server_port() AS port`
    );
    const info = db.rows[0];
    if (info.db !== 'kh_phase2_test' || info.port !== 5433 || !(info.addr.startsWith('127.') || info.addr.startsWith('::1'))) {
      throw new Error(`Refusing scan & add tests against ${info.db} at ${info.addr}:${info.port}`);
    }
    await pool.query(fs.readFileSync(path.resolve(process.cwd(), 'database/migrations/409_items_scan_onboarding_feature.sql'), 'utf8'));
    await pool.query(
      `INSERT INTO businesses (id, name, state_code, gst_registration_type) VALUES ($1, $2, '27', 'regular'), ($3, $4, '27', 'regular')`,
      [B, `Scan add ${tag}`, OTHER, `Scan add other ${tag}`]
    );
    await pool.query(
      `INSERT INTO branches (id, business_id, name, state_code, is_primary, is_default, is_active)
       VALUES ($1, $2, 'Main', '27', true, true, true), ($3, $4, 'Main', '27', true, true, true)`,
      [BR, B, OBR, OTHER]
    );
    const phone = Date.now().toString().slice(-9);
    await pool.query(
      `INSERT INTO users (id, business_id, name, phone, is_primary_admin, auth_session_version, is_active)
       VALUES ($1, $2, 'Owner', $3, true, 1, true), ($4, $5, 'Other owner', $6, true, 1, true)`,
      [USER, B, `6${phone}`, OUSER, OTHER, `7${phone}`]
    );
    await pool.query(`SELECT create_default_chart_of_accounts($1)`, [B]);
    await pool.query(`SELECT create_default_chart_of_accounts($1)`, [OTHER]);
    // Free plan, so the item limit check runs exactly as it does for a new shop.
    await pool.query(
      `INSERT INTO business_module_subscriptions (business_id, module_key, plan_id, status, start_date, end_date)
       VALUES ($1, 'billing', 'free', 'active', CURRENT_DATE, CURRENT_DATE + 365)`,
      [B]
    );
  });

  afterAll(async () => {
    if (!pool) return;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await withLedgerDelete(client, 'tenant_purge', USER, async () => {
        await client.query(`DELETE FROM businesses WHERE id = ANY($1::uuid[])`, [[B, OTHER]]);
      });
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
      await closePool();
    }
  });

  test('the feature is on for every plan', async () => {
    const r = await pool.query(
      `SELECT COUNT(*)::int AS plans,
              COUNT(f.plan_id) FILTER (WHERE f.enabled)::int AS enabled
         FROM subscription_plans p
         LEFT JOIN subscription_plan_features f ON f.plan_id = p.id AND f.feature_id = 'items_scan_onboarding'`
    );
    expect(r.rows[0].plans).toBeGreaterThan(0);
    expect(r.rows[0].enabled).toBe(r.rows[0].plans);
  });

  test('a retried save returns the same item and posts opening stock once', async () => {
    const key = randomUUID();
    const body = { name: `Parle-G 100 g ${tag}`, barcode: '0089012345675', unit: 'PCS', purchase_price: 8, selling_price: 10, mrp: 10, opening_stock: 20, net_quantity: '100 g' };
    const first = await create(body, key);
    expect([first.status, first.json.error]).toEqual([201, undefined]);
    expect(first.json.item.barcode).toBe('0089012345675');

    const retry = await create(body, key);
    expect(retry.status).toBe(200);
    expect(retry.json.idempotent).toBe(true);
    expect(retry.json.item.id).toBe(first.json.item.id);

    const facts = await stockFacts(first.json.item.id);
    expect(facts.items).toBe(1);
    expect(facts.movements).toBe(1);
    expect(Number(facts.moved)).toBe(20);
    expect(Number(facts.current_stock)).toBe(20);
    expect(Number(facts.opening_value)).toBe(160);
  });

  test('two saves with the same key at once still create one item', async () => {
    const key = randomUUID();
    const body = { name: `Maggi 70 g ${tag}`, barcode: '8901058000009', purchase_price: 12, opening_stock: 5 };
    const [a, b] = await Promise.all([create(body, key), create(body, key)]);
    expect([a.status, b.status].sort()).toEqual([200, 201]);
    expect(a.json.item.id).toBe(b.json.item.id);
    expect((await stockFacts(a.json.item.id)).movements).toBe(1);
  });

  test('a key reused for a different product is refused', async () => {
    const key = randomUUID();
    expect((await create({ name: `Tata Salt ${tag}`, purchase_price: 20, opening_stock: 3 }, key)).status).toBe(201);
    const other = await create({ name: `Tata Salt ${tag}`, purchase_price: 20, opening_stock: 4 }, key);
    expect(other.status).toBe(409);
    expect(other.json.code).toBe('IDEMPOTENCY_KEY_REUSED');
  });

  test('a save without a key works as before', async () => {
    const res = await create({ name: `No key item ${tag}`, purchase_price: 5, opening_stock: 2 });
    expect([res.status, res.json.error]).toEqual([201, undefined]);
    const facts = await stockFacts(res.json.item.id);
    expect(facts.movements).toBe(1);
    expect(Number(facts.current_stock)).toBe(2);
  });

  test('a barcode already in the shop is reported, not overwritten', async () => {
    const dup = await create({ name: `Another product ${tag}`, barcode: '0089012345675', purchase_price: 1, opening_stock: 1 }, randomUUID());
    expect(dup.status).toBe(400);

    const found = await lookup(' 0089012345675 ');
    expect(found.status).toBe(200);
    expect(found.json.match.item.name).toBe(`Parle-G 100 g ${tag}`);
    expect(found.json.match.has_history).toBe(false);
    expect(found.json.match.matched_variant_id).toBeNull();
  });

  test('leading zeroes matter: a shorter code is a different barcode', async () => {
    expect((await lookup('89012345675')).json.match).toBeNull();
  });

  test("another business never sees this shop's barcode", async () => {
    const res = await lookup('0089012345675', [OUSER, OTHER]);
    expect(res.status).toBe(200);
    expect(res.json.match).toBeNull();
  });

  test('an empty code is a bad request', async () => {
    expect((await lookup('')).status).toBe(400);
  });
});
