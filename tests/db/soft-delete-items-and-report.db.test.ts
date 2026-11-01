/**
 * Remaining soft-delete checks: item list, item-delete permission, deleted-records report.
 * Calls the real route handlers. Does not stub authorize, module access, or report access.
 * Connects only after current_database() is kh_phase2_test on localhost.
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
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!m) continue;
    let val = m[2].trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    out[m[1]] = val;
  }
  return out;
}

function forceDisposableDatabase(): void {
  const env = readEnvFile(path.resolve(process.cwd(), '.env'));
  const host = env.DB_HOST || '';
  if (host !== 'localhost' && host !== '127.0.0.1' && host !== '::1') {
    throw new Error('Refusing soft-delete tests: database host is not local');
  }
  if (!env.DB_USER || env.DB_PASSWORD == null) {
    throw new Error('Refusing soft-delete tests: local database credentials are missing');
  }
  const port = env.DB_PORT || '5432';
  process.env.DATABASE_URL = `postgresql://${encodeURIComponent(env.DB_USER)}:${encodeURIComponent(env.DB_PASSWORD)}@${host}:${port}/kh_phase2_test`;
  process.env.DB_NAME = 'kh_phase2_test';
}

forceDisposableDatabase();

const headerBag: { current: Record<string, string> } = { current: {} };
(global as unknown as { __softDeleteHeaders: typeof headerBag }).__softDeleteHeaders = headerBag;

jest.mock('next/headers', () => ({
  headers: jest.fn(async () => ({
    get: (name: string) =>
      (global as unknown as { __softDeleteHeaders: { current: Record<string, string> } }).__softDeleteHeaders
        .current[name.toLowerCase()] ?? null,
  })),
  cookies: jest.fn(async () => ({ get: () => undefined })),
}));
jest.mock('@/lib/jwt', () => ({
  clearSessionCookie: jest.fn(),
  shouldRotateTokens: jest.fn(async () => ({ rotate: false, payload: null })),
}));

import { getPool, closePool } from '@/lib/db';
import { GET as listItems } from '@/app/api/items/route';
import { DELETE as deleteItem } from '@/app/api/items/[id]/route';
import { GET as deletedRecords } from '@/app/api/reports/deleted-items/route';

describe('soft-delete item list, permission, and deleted-records report', () => {
  jest.setTimeout(120000);
  let pool: Pool;
  const B = randomUUID();
  const BR = randomUUID();
  const OWNER = randomUUID();
  const DENIED = randomUUID();
  const ALLOWED = randomUUID();
  const ROLE_READ = randomUUID();
  const ROLE_DELETE = randomUUID();
  const ACTIVE = randomUUID();
  const HIDDEN = randomUUID();
  const INACTIVE = randomUUID();
  const TO_DELETE = randomUUID();
  const INVOICE = randomUUID();
  const SUPPLIER = randomUUID();
  const tag = B.slice(0, 8);

  function session(userId: string, version = '1') {
    headerBag.current = {
      'x-authenticated-user-id': userId,
      'x-authenticated-business-id': B,
      'x-authenticated-session-version': version,
    };
  }

  function call(res: Response) {
    return res.json().then((json) => ({ status: res.status, json }));
  }

  async function itemRow(id: string) {
    const row = await pool.query<{ name: string; deleted_at: string | null; is_active: boolean }>(
      `SELECT name, deleted_at::text, is_active FROM items WHERE id = $1 AND business_id = $2`,
      [id, B],
    );
    return row.rows[0] ?? null;
  }

  beforeAll(async () => {
    pool = getPool();
    const db = await pool.query<{ db: string; addr: string; port: number }>(
      `SELECT current_database() AS db, inet_server_addr()::text AS addr, inet_server_port() AS port`,
    );
    const info = db.rows[0];
    if (info.db !== 'kh_phase2_test' || info.port !== 5433 || !info.addr.includes('127.0.0.1') && !info.addr.includes('::1')) {
      throw new Error(`Refusing soft-delete tests against ${info.db} at ${info.addr}:${info.port}`);
    }

    const plan = await pool.query<{ plan_id: string }>(
      `SELECT plan_id FROM subscription_plan_features
        WHERE feature_id = 'reports_basic' AND enabled = true
        ORDER BY plan_id LIMIT 1`,
    );
    if (!plan.rows[0]) throw new Error('No enabled reports_basic plan in kh_phase2_test');
    const planId = plan.rows[0].plan_id;

    await pool.query(
      `INSERT INTO permission_modules (module_key, module_name, is_active)
       VALUES ('items', 'Items', true) ON CONFLICT (module_key) DO NOTHING`,
    );
    await pool.query(
      `INSERT INTO businesses (id, name, gstin, state_code, gst_registration_type, primary_module)
       VALUES ($1, $2, '27AAAPA1234A1Z5', '27', 'regular', 'billing')`,
      [B, `Soft delete ${tag}`],
    );
    await pool.query(
      `INSERT INTO branches (id, business_id, name, is_default, is_active) VALUES ($1, $2, 'Main', true, true)`,
      [BR, B],
    );
    await pool.query(
      `INSERT INTO business_modules (business_id, module_key, enabled, source) VALUES ($1, 'billing', true, 'test')`,
      [B],
    );
    await pool.query(
      `INSERT INTO business_module_subscriptions (business_id, module_key, plan_id, status, start_date, end_date)
       VALUES ($1, 'billing', $2, 'active', CURRENT_DATE, CURRENT_DATE + 30)`,
      [B, planId],
    );
    await pool.query(
      `INSERT INTO user_roles (id, business_id, role_name, role_key, is_system_role) VALUES
         ($1, $3, 'Read only', 'qa_read', false),
         ($2, $3, 'Can delete', 'qa_delete', false)`,
      [ROLE_READ, ROLE_DELETE, B],
    );
    await pool.query(
      `INSERT INTO role_permissions (role_id, module_key, can_view, can_add, can_modify, can_delete, can_share)
       VALUES ($1, 'items', true, false, false, false, false),
              ($2, 'items', true, false, false, true, false)`,
      [ROLE_READ, ROLE_DELETE],
    );
    const phone = Date.now().toString().slice(-7);
    await pool.query(
      `INSERT INTO users (id, business_id, name, phone, is_primary_admin, role_id, auth_session_version, is_active)
       VALUES ($1, $4, 'Owner', $5, true, NULL, 1, true),
              ($2, $4, 'No delete', $6, false, $7, 1, true),
              ($3, $4, 'Can delete', $8, false, $9, 1, true)`,
      [OWNER, DENIED, ALLOWED, B, `91${phone}1`, `91${phone}2`, ROLE_READ, `91${phone}3`, ROLE_DELETE],
    );
    await pool.query(
      `INSERT INTO items (id, business_id, name, item_type, unit, selling_price, is_active)
       VALUES ($1, $4, $5, 'goods', 'PCS', 10, true),
              ($2, $4, $6, 'goods', 'PCS', 10, true),
              ($3, $4, $7, 'goods', 'PCS', 10, false)`,
      [ACTIVE, HIDDEN, INACTIVE, B, `Active ${tag}`, `Hidden ${tag}`, `Inactive ${tag}`],
    );
    await pool.query(`UPDATE items SET deleted_at = CURRENT_TIMESTAMP WHERE id = $1`, [HIDDEN]);
    await pool.query(
      `INSERT INTO items (id, business_id, name, item_type, unit, selling_price, is_active)
       VALUES ($1, $2, $3, 'goods', 'PCS', 10, true),
              ($4, $2, $5, 'goods', 'PCS', 10, true)`,
      [TO_DELETE, B, `Will delete ${tag}`, randomUUID(), `Denied target ${tag}`],
    );
    const deniedTarget = (
      await pool.query<{ id: string }>(`SELECT id FROM items WHERE business_id = $1 AND name = $2`, [B, `Denied target ${tag}`])
    ).rows[0].id;
    (global as unknown as { __deniedItem: string }).__deniedItem = deniedTarget;

    await pool.query(
      `INSERT INTO invoices (id, business_id, invoice_number, invoice_date, status, document_type,
          place_of_supply_state_code, subtotal, tax_total, grand_total, paid_amount, balance_amount,
          payment_status, branch_id)
       VALUES ($1, $2, $3, CURRENT_DATE, 'final', 'tax_invoice', '27', 10, 0, 10, 0, 10, 'unpaid', $4)`,
      [INVOICE, B, `SD-${tag}`, BR],
    );
    await pool.query(`UPDATE invoices SET deleted_at = CURRENT_TIMESTAMP WHERE id = $1`, [INVOICE]);
    await pool.query(
      `INSERT INTO suppliers (id, business_id, name) VALUES ($1, $2, $3)`,
      [SUPPLIER, B, `Deleted supplier ${tag}`],
    );
    await pool.query(`UPDATE suppliers SET deleted_at = CURRENT_TIMESTAMP WHERE id = $1`, [SUPPLIER]);
  });

  afterAll(async () => {
    if (!pool) return;
    try {
      await pool.query(`DELETE FROM user_activity_logs WHERE business_id = $1`, [B]);
      await pool.query(`DELETE FROM suppliers WHERE business_id = $1`, [B]);
      await pool.query(`DELETE FROM invoices WHERE business_id = $1`, [B]);
      await pool.query(`DELETE FROM items WHERE business_id = $1`, [B]);
      await pool.query(`DELETE FROM users WHERE business_id = $1`, [B]);
      await pool.query(`DELETE FROM role_permissions WHERE role_id IN ($1, $2)`, [ROLE_READ, ROLE_DELETE]);
      await pool.query(`DELETE FROM user_roles WHERE business_id = $1`, [B]);
      await pool.query(`DELETE FROM business_module_subscriptions WHERE business_id = $1`, [B]);
      await pool.query(`DELETE FROM business_modules WHERE business_id = $1`, [B]);
      await pool.query(`DELETE FROM branches WHERE business_id = $1`, [B]);
      await pool.query(`DELETE FROM businesses WHERE id = $1`, [B]);
    } finally {
      await closePool();
    }
  });

  test('GET /api/items lists the active item and omits the soft-deleted and inactive items', async () => {
    session(OWNER);
    const res = await call(
      await listItems(
        new NextRequest(`http://localhost/api/items?search=${encodeURIComponent(tag)}`, {
          headers: headerBag.current,
        }),
      ),
    );
    expect(res.status).toBe(200);
    const ids = (res.json.items as { id: string }[]).map((row) => row.id);
    expect(ids).toContain(ACTIVE);
    expect(ids).not.toContain(HIDDEN);
    expect(ids).not.toContain(INACTIVE);
  });

  test('GET /api/items?store_only=1 lists only items the online store sells', async () => {
    const SHOWN = randomUUID();
    const FEATURED = randomUUID();
    const OFFLINE = randomUUID();
    await pool.query(
      `INSERT INTO items (id, business_id, name, item_type, unit, selling_price, is_active, show_in_store, featured_in_store)
       VALUES ($1, $4, $5, 'goods', 'PCS', 10, true, true, false),
              ($2, $4, $6, 'goods', 'PCS', 10, true, false, true),
              ($3, $4, $7, 'goods', 'PCS', 10, true, false, false)`,
      [SHOWN, FEATURED, OFFLINE, B, `StoreQA-${tag} shown`, `StoreQA-${tag} featured`, `StoreQA-${tag} offline`],
    );
    session(OWNER);
    const list = async (qs: string) => {
      const res = await call(
        await listItems(new NextRequest(`http://localhost/api/items?search=${encodeURIComponent(`StoreQA-${tag}`)}${qs}`, { headers: headerBag.current })),
      );
      expect(res.status).toBe(200);
      return { ids: (res.json.items as { id: string }[]).map((r) => r.id).sort(), total: res.json.pagination.total };
    };
    // Without the param nothing changes: every matching item is listed.
    expect(await list('')).toEqual({ ids: [SHOWN, FEATURED, OFFLINE].sort(), total: 3 });
    // Same rule as the storefront item route: featured but not shown in the store is left out.
    expect(await list('&store_only=1')).toEqual({ ids: [SHOWN], total: 1 });
    // Only the exact opt-in value filters.
    expect((await list('&store_only=true')).total).toBe(3);
  });

  test('a user without items delete permission is rejected and the item is unchanged', async () => {
    const deniedItem = (global as unknown as { __deniedItem: string }).__deniedItem;
    const before = await itemRow(deniedItem);
    session(DENIED);
    const res = await call(
      await deleteItem(
        new NextRequest(`http://localhost/api/items/${deniedItem}`, {
          method: 'DELETE',
          headers: { ...headerBag.current, 'content-type': 'application/json' },
          body: JSON.stringify({ business_id: B, user_id: OWNER }),
        }),
        { params: { id: deniedItem } },
      ),
    );
    expect(res.status).toBe(403);
    expect(res.json.code).toBe('PERMISSION_DENIED');
    expect(await itemRow(deniedItem)).toEqual(before);
  });

  test('a user with items delete permission soft-deletes and keeps the row', async () => {
    session(ALLOWED);
    const res = await call(
      await deleteItem(
        new NextRequest(`http://localhost/api/items/${TO_DELETE}`, {
          method: 'DELETE',
          headers: { ...headerBag.current, 'content-type': 'application/json' },
          body: JSON.stringify({ user_id: DENIED, business_id: randomUUID() }),
        }),
        { params: { id: TO_DELETE } },
      ),
    );
    expect(res.status).toBe(200);
    const row = await itemRow(TO_DELETE);
    expect(row?.name).toBe(`Will delete ${tag}`);
    expect(row?.deleted_at).toBeTruthy();

    session(OWNER);
    const list = await call(
      await listItems(
        new NextRequest(`http://localhost/api/items?search=${encodeURIComponent('Will delete ' + tag)}`, {
          headers: headerBag.current,
        }),
      ),
    );
    expect(list.status).toBe(200);
    expect((list.json.items as { id: string }[]).map((r) => r.id)).not.toContain(TO_DELETE);
  });

  test('GET /api/reports/deleted-items returns deleted documents and not catalog items', async () => {
    session(OWNER);
    const res = await call(
      await deletedRecords(
        new NextRequest('http://localhost/api/reports/deleted-items?type=all', {
          headers: headerBag.current,
        }),
      ),
    );
    expect(res.status).toBe(200);
    const rows = res.json.items as { id: string; type: string }[];
    const types = new Set(rows.map((row) => row.type));
    expect(rows.map((row) => row.id)).toEqual(expect.arrayContaining([INVOICE, SUPPLIER]));
    expect(rows.map((row) => row.id)).not.toContain(HIDDEN);
    expect(rows.map((row) => row.id)).not.toContain(ACTIVE);
    for (const type of types) {
      expect(['invoice', 'purchase', 'payment', 'supplier']).toContain(type);
    }
  });
});
