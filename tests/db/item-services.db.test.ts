/**
 * Real-PostgreSQL test: createImportedItem, the service behind POST /api/items/import and the import.
 * Runs only when PHASE2_TEST_DATABASE_URL points at a disposable database.
 * Creates its own business and removes only that.
 */
import { randomUUID } from 'crypto';
import type { Pool } from 'pg';

const url = process.env.PHASE2_TEST_DATABASE_URL;
if (url) process.env.DATABASE_URL = url;
const d = url ? describe : describe.skip;

jest.mock('next/headers', () => ({
  headers: jest.fn(async () => ({ get: () => null })),
  cookies: jest.fn(async () => ({ get: () => undefined })),
}));

jest.mock('@/lib/jwt', () => ({
  clearSessionCookie: jest.fn(),
  shouldRotateTokens: jest.fn(async () => ({ rotate: false, payload: null })),
}));
jest.mock('@/lib/platform-jwt', () => ({ getPlatformSessionFromRequest: jest.fn(async () => null) }));

import { getPool, closePool } from '@/lib/db';
import { withLedgerDelete } from '@/lib/accounting/ledger-delete-guard';
import { createImportedItem } from '@/lib/items/create-imported-item';

d('createImportedItem (real DB)', () => {
  jest.setTimeout(60000);

  let pool: Pool;
  const B = randomUUID();
  const BR = randomUUID();
  const U = randomUUID();
  const CAT = randomUUID();
  const tag = B.slice(0, 8);
  const ctx = { businessId: B, userId: U };

  const itemRow = async (id: string) =>
    (await pool.query(`SELECT * FROM items WHERE id = $1 AND business_id = $2`, [id, B])).rows[0];
  const movements = async (id: string) =>
    Number((await pool.query(`SELECT COUNT(*)::int AS n FROM stock_movements WHERE item_id = $1`, [id])).rows[0].n);
  const itemCount = async () =>
    Number((await pool.query(`SELECT COUNT(*)::int AS n FROM items WHERE business_id = $1`, [B])).rows[0].n);
  const create = async (input: Parameters<typeof createImportedItem>[1]) => {
    const r = await createImportedItem(ctx, input);
    if (!r.ok) throw new Error(`create failed: ${r.code}`);
    return r.record.id;
  };

  beforeAll(async () => {
    pool = getPool();
    const orphans = await pool.query<{ id: string }>(`SELECT id FROM businesses WHERE name LIKE 'Item svc %'`);
    if (orphans.rows.length) await purge(orphans.rows.map((row) => row.id));
    await pool.query(
      `INSERT INTO businesses (id, name, gstin, state_code, gst_registration_type, primary_module)
       VALUES ($1, $2, '27AAAPA1234A1Z5', '27', 'regular', 'billing')`,
      [B, `Item svc ${tag}`]
    );
    await pool.query(
      `INSERT INTO branches (id, business_id, name, state_code, is_primary, is_default, is_active)
       VALUES ($1, $2, 'Main', '27', true, true, true)`,
      [BR, B]
    );
    await pool.query(
      `INSERT INTO users (id, business_id, name, phone, is_primary_admin, auth_session_version, is_active)
       VALUES ($1, $2, 'Admin', $3, true, 1, true)`,
      [U, B, `95${Date.now().toString().slice(-8)}`]
    );
    // The opening stock ledger posts Dr Inventory (1104) / Cr Opening Balance Adjustment (3100).
    for (const [code, name, type, nature] of [
      ['1104', 'Inventory', 'asset', 'debit'],
      ['3100', 'Opening Balance Adjustment', 'equity', 'credit'],
    ]) {
      await pool.query(
        `INSERT INTO accounts (id, business_id, account_code, account_name, account_type, nature, is_system)
         VALUES ($1, $2, $3, $4, $5, $6, true)`,
        [randomUUID(), B, code, name, type, nature]
      );
    }
    await pool.query(`INSERT INTO categories (id, business_id, name) VALUES ($1, $2, 'Beverages')`, [CAT, B]);
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
        await c.query(`DELETE FROM stock_movements WHERE business_id = $1`, [id]);
        await c.query(`DELETE FROM branch_item_stock WHERE business_id = $1`, [id]);
        await c.query(`DELETE FROM items WHERE business_id = $1`, [id]);
        await c.query(`DELETE FROM categories WHERE business_id = $1`, [id]);
        await c.query(`DELETE FROM activity_logs WHERE business_id = $1`, [id]);
        await c.query(`DELETE FROM accounts WHERE business_id = $1`, [id]);
        await c.query(`DELETE FROM account_groups WHERE business_id = $1`, [id]);
        await c.query(`DELETE FROM user_branches WHERE user_id IN (SELECT id FROM users WHERE business_id = $1)`, [id]);
        await c.query(`DELETE FROM branches WHERE business_id = $1`, [id]);
        await c.query(`DELETE FROM users WHERE business_id = $1`, [id]);
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

  test('a goods item with opening stock gets the stock, one movement, a branch layer and a ledger voucher', async () => {
    const id = await create({ name: 'Cola', opening_stock: 5, purchase_price: 10 });
    const row = await itemRow(id);
    expect(Number(row.current_stock)).toBe(5);
    expect(Number(row.opening_stock)).toBe(5);
    expect(await movements(id)).toBe(1);
    const layer = await pool.query(`SELECT quantity FROM branch_item_stock WHERE item_id = $1 AND branch_id = $2`, [id, BR]);
    expect(Number(layer.rows[0].quantity)).toBe(5);
    const lines = await pool.query(
      `SELECT COUNT(*)::int AS n, COALESCE(SUM(debit), 0)::numeric AS dr FROM ledger_entry_lines
        WHERE business_id = $1 AND voucher_id = $2 AND voucher_type = 'opening_stock'`,
      [B, id]
    );
    expect(lines.rows[0].n).toBe(2);
    expect(Number(lines.rows[0].dr)).toBe(50);
  });

  test('a service item ignores opening stock: zero stock, no movement', async () => {
    const id = await create({ name: 'Repair', item_type: 'service', opening_stock: 5 });
    const row = await itemRow(id);
    expect(row.item_type).toBe('service');
    expect(Number(row.current_stock)).toBe(0);
    expect(await movements(id)).toBe(0);
  });

  test('a missing name is refused and creates nothing', async () => {
    const before = await itemCount();
    const r = await createImportedItem(ctx, { name: '' });
    expect(r).toMatchObject({ ok: false, status: 400, code: 'MISSING_NAME', error: 'Missing name' });
    expect(await itemCount()).toBe(before);
  });

  test('category_name matching a category sets category_id; no match leaves it null', async () => {
    const hit = await create({ name: 'Juice', category_name: ' Beverages ' });
    expect((await itemRow(hit)).category_id).toBe(CAT);
    const miss = await create({ name: 'Mystery', category_name: 'No such category' });
    expect((await itemRow(miss)).category_id).toBeNull();
  });

  test('defaults: PCS, goods, tax 18, prices 0, active', async () => {
    const row = await itemRow(await create({ name: 'Plain' }));
    expect(row.unit).toBe('PCS');
    expect(row.item_type).toBe('goods');
    expect(Number(row.tax_rate)).toBe(18);
    expect(Number(row.selling_price)).toBe(0);
    expect(Number(row.purchase_price)).toBe(0);
    expect(Number(row.current_stock)).toBe(0);
    expect(row.is_active).toBe(true);
  });

  test('is_active false is kept', async () => {
    const row = await itemRow(await create({ name: 'Dormant', is_active: false }));
    expect(row.is_active).toBe(false);
  });
});
