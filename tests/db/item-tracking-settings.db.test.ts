/**
 * Item batch / serial tracking and valuation method: POST /api/items and PATCH /api/items/[id]
 * save what the item form sends, and refuse switches that would strand stock.
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
    throw new Error('Refusing item tracking tests: database host is not local');
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
import { PATCH as patchItem } from '@/app/api/items/[id]/route';

describe('item tracking settings', () => {
  jest.setTimeout(120000);
  let pool: Pool;
  const B = randomUUID();
  const BR = randomUUID();
  const USER = randomUUID();
  const tag = B.slice(0, 8);
  const headers = {
    'content-type': 'application/json',
    'x-authenticated-user-id': USER,
    'x-authenticated-business-id': B,
    'x-authenticated-session-version': '1',
  };

  async function create(body: Record<string, unknown>) {
    const res = await postItem(new NextRequest('http://localhost/api/items', { method: 'POST', headers, body: JSON.stringify(body) }));
    return { status: res.status, json: await res.json() };
  }
  async function patch(id: string, body: Record<string, unknown>) {
    const res = await patchItem(
      new NextRequest(`http://localhost/api/items/${id}`, { method: 'PATCH', headers, body: JSON.stringify(body) }),
      { params: { id } }
    );
    return { status: res.status, json: await res.json() };
  }
  async function stored(id: string) {
    const r = await pool.query(`SELECT track_batch, track_serial, valuation_method FROM items WHERE id = $1`, [id]);
    return r.rows[0];
  }

  beforeAll(async () => {
    pool = getPool();
    const db = await pool.query<{ db: string; addr: string; port: number }>(
      `SELECT current_database() AS db, inet_server_addr()::text AS addr, inet_server_port() AS port`
    );
    const info = db.rows[0];
    if (info.db !== 'kh_phase2_test' || info.port !== 5433 || !(info.addr.startsWith('127.') || info.addr.startsWith('::1'))) {
      throw new Error(`Refusing item tracking tests against ${info.db} at ${info.addr}:${info.port}`);
    }
    await pool.query(`INSERT INTO businesses (id, name, state_code, gst_registration_type) VALUES ($1, $2, '27', 'regular')`, [B, `Tracking ${tag}`]);
    await pool.query(
      `INSERT INTO branches (id, business_id, name, state_code, is_primary, is_default, is_active) VALUES ($1, $2, 'Main', '27', true, true, true)`,
      [BR, B]
    );
    const phone = Date.now().toString().slice(-9);
    await pool.query(
      `INSERT INTO users (id, business_id, name, phone, is_primary_admin, auth_session_version, is_active) VALUES ($1, $2, 'Owner', $3, true, 1, true)`,
      [USER, B, `5${phone}`]
    );
    await pool.query(`SELECT create_default_chart_of_accounts($1)`, [B]);
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
        await client.query(`DELETE FROM businesses WHERE id = $1`, [B]);
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

  test('a new item saves batch tracking and its valuation method', async () => {
    const r = await create({ name: `Paracetamol ${tag}`, purchase_price: 10, selling_price: 15, track_batch: true, valuation_method: 'weighted_avg' });
    expect([r.status, r.json.error]).toEqual([201, undefined]);
    expect(await stored(r.json.item.id)).toEqual({ track_batch: true, track_serial: false, valuation_method: 'weighted_avg' });
  });

  test('a new item saves serial tracking when it starts with no stock', async () => {
    const r = await create({ name: `Phone ${tag}`, purchase_price: 9000, selling_price: 10000, track_serial: true, valuation_method: 'fifo' });
    expect(r.status).toBe(201);
    expect(await stored(r.json.item.id)).toEqual({ track_batch: false, track_serial: true, valuation_method: 'fifo' });
  });

  test('a new serial-tracked item cannot start with opening stock', async () => {
    const r = await create({ name: `Phone stock ${tag}`, purchase_price: 9000, opening_stock: 3, track_serial: true });
    expect([r.status, r.json.code]).toEqual([400, 'STOCK_WITHOUT_SERIALS']);
    const n = await pool.query(`SELECT COUNT(*)::int AS n FROM items WHERE business_id = $1 AND name = $2`, [B, `Phone stock ${tag}`]);
    expect(n.rows[0].n).toBe(0);
  });

  test('a service cannot be tracked, and an unknown valuation method is refused', async () => {
    expect((await create({ name: `Repair ${tag}`, item_type: 'service', track_batch: true })).json.code).toBe('TRACKING_NOT_ALLOWED');
    expect((await create({ name: `Odd ${tag}`, valuation_method: 'lifo' })).json.code).toBe('INVALID_VALUATION_METHOD');
  });

  test('an item without the fields keeps the defaults', async () => {
    const r = await create({ name: `Plain ${tag}`, purchase_price: 5 });
    expect(await stored(r.json.item.id)).toEqual({ track_batch: false, track_serial: false, valuation_method: 'simple' });
  });

  test('editing an item saves the settings, and an edit without them leaves them alone', async () => {
    const { json } = await create({ name: `Soap ${tag}`, purchase_price: 20 });
    const id = json.item.id;
    const on = await patch(id, { name: `Soap ${tag}`, track_batch: true, valuation_method: 'fifo' });
    expect([on.status, on.json.error]).toEqual([200, undefined]);
    expect(await stored(id)).toEqual({ track_batch: true, track_serial: false, valuation_method: 'fifo' });

    expect((await patch(id, { name: `Soap bar ${tag}` })).status).toBe(200);
    expect(await stored(id)).toEqual({ track_batch: true, track_serial: false, valuation_method: 'fifo' });
  });

  test('batch tracking cannot be turned off while batches hold stock', async () => {
    const { json } = await create({
      name: `Syrup ${tag}`,
      purchase_price: 40,
      opening_stock: 6,
      opening_batch: { batch_number: 'B1', expiry_date: '2027-12-31' },
    });
    const id = json.item.id;
    expect((await stored(id)).track_batch).toBe(true);
    const off = await patch(id, { name: `Syrup ${tag}`, track_batch: false });
    expect([off.status, off.json.code]).toEqual([409, 'BATCHES_IN_STOCK']);
    expect((await stored(id)).track_batch).toBe(true);

    await pool.query(`UPDATE item_batches SET quantity = 0 WHERE item_id = $1`, [id]);
    expect((await patch(id, { name: `Syrup ${tag}`, track_batch: false })).status).toBe(200);
    expect((await stored(id)).track_batch).toBe(false);
  });

  test('serial tracking cannot be turned on over stock without serial numbers', async () => {
    const { json } = await create({ name: `Charger ${tag}`, purchase_price: 300, opening_stock: 2 });
    const id = json.item.id;
    const on = await patch(id, { name: `Charger ${tag}`, track_serial: true });
    expect([on.status, on.json.code]).toEqual([409, 'STOCK_WITHOUT_SERIALS']);
    expect((await stored(id)).track_serial).toBe(false);
  });

  test('serial tracking cannot be turned off while serials are in stock', async () => {
    const { json } = await create({ name: `Laptop ${tag}`, purchase_price: 40000, track_serial: true });
    const id = json.item.id;
    await pool.query(
      `INSERT INTO item_serials (business_id, item_id, serial_number, purchase_price, status) VALUES ($1, $2, 'SN-1', 40000, 'available')`,
      [B, id]
    );
    const off = await patch(id, { name: `Laptop ${tag}`, track_serial: false });
    expect([off.status, off.json.code]).toEqual([409, 'SERIALS_IN_STOCK']);
    expect((await stored(id)).track_serial).toBe(true);
  });
});
