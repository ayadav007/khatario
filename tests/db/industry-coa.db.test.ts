/**
 * Real-PostgreSQL tests for industry ledger packs. Runs only when PHASE2_TEST_DATABASE_URL points
 * at the disposable test database with the application schema.
 */
import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import type { Pool } from 'pg';

const migration334 = fs.readFileSync(path.join(__dirname, '../../database/migrations/334_pl_section.sql'), 'utf8');

const url = process.env.PHASE2_TEST_DATABASE_URL;
if (url) process.env.DATABASE_URL = url;
const d = url ? describe : describe.skip;

import { getPool, closePool } from '@/lib/db';
import { applyIndustryCoa, previewIndustryCoa } from '@/lib/accounting/apply-industry-coa';

d('industry chart of accounts (real DB)', () => {
  jest.setTimeout(60000);
  let pool: Pool;
  const created: string[] = [];

  async function newBusiness(industry: string, businessType: string, businessModel: string | null, seed = true) {
    const id = randomUUID();
    created.push(id);
    await pool.query(
      `INSERT INTO businesses (id, name, state_code, gst_registration_type, industry, business_type, business_model)
       VALUES ($1, $2, '27', 'regular', $3, $4, $5)`,
      [id, `IndustryCoa ${id.slice(0, 8)}`, industry, businessType, businessModel]
    );
    if (seed) {
      await pool.query(`SELECT create_default_chart_of_accounts($1)`, [id]);
      await pool.query(`SELECT ensure_standard_account_heads($1)`, [id]);
    }
    return id;
  }

  async function withClient<T>(fn: (c: import('pg').PoolClient) => Promise<T>): Promise<T> {
    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      const out = await fn(c);
      await c.query('COMMIT');
      return out;
    } catch (e) {
      await c.query('ROLLBACK');
      throw e;
    } finally {
      c.release();
    }
  }

  beforeAll(async () => {
    pool = getPool();
    await pool.query(migration334);
  });

  afterAll(async () => {
    if (pool) {
      for (const id of created) {
        await pool.query(`DELETE FROM expense_categories WHERE business_id = $1`, [id]);
        await pool.query(`DELETE FROM accounts WHERE business_id = $1`, [id]);
        await pool.query(`DELETE FROM account_groups WHERE business_id = $1`, [id]);
        await pool.query(`DELETE FROM business_settings WHERE business_id = $1`, [id]);
        await pool.query(`DELETE FROM businesses WHERE id = $1`, [id]);
      }
    }
    await closePool();
  });

  it('seeds a garment exporter-manufacturer and is idempotent', async () => {
    const B = await newBusiness('garments', 'manufacturer', 'export');
    const first = await withClient((c) => applyIndustryCoa(c, B));
    expect(first.packs.map((p) => p.key)).toEqual(['type:manufacturer', 'industry:garments', 'model:export', 'model:export:textiles']);
    expect(first.accountsCreated).toEqual(expect.arrayContaining(['5110', '5116', '1142', '4111', '2120']));
    expect(first.conflictingCodes).toEqual([]);

    const { rows: acc } = await pool.query(
      `SELECT a.account_code, a.account_type, a.nature, a.is_system, a.pl_section, g.group_code
         FROM accounts a JOIN account_groups g ON g.id = a.account_group_id
        WHERE a.business_id = $1 AND a.account_code IN ('5110', '5234', '4111', '2120', '1142')`,
      [B]
    );
    const by = Object.fromEntries(acc.map((r) => [r.account_code, r]));
    expect(by['5110']).toMatchObject({ group_code: '5100', account_type: 'expense', nature: 'debit', is_system: false, pl_section: 'cost_of_goods_sold' });
    expect(by['5234']).toMatchObject({ group_code: '5200', pl_section: 'other_expense' });
    expect(by['4111']).toMatchObject({ account_type: 'income', nature: 'credit', pl_section: 'operating_income' });
    expect(by['2120']).toMatchObject({ account_type: 'liability', pl_section: null });
    expect(by['1142']).toMatchObject({ account_type: 'asset', group_code: '1100' });

    const { rows: cats } = await pool.query(
      `SELECT ec.name, a.account_code, ec.itc_blocked
         FROM expense_categories ec LEFT JOIN accounts a ON a.id = ec.account_id
        WHERE ec.business_id = $1`,
      [B]
    );
    const cat = Object.fromEntries(cats.map((r) => [r.name, r]));
    expect(cat['Stitching Job Work']).toMatchObject({ account_code: '5110', itc_blocked: false });
    expect(cat['Export Freight & Clearing']).toMatchObject({ account_code: '5232' });
    expect(cat['Rent']).toMatchObject({ account_code: '5213' });
    expect(cat['Food & Refreshments']).toMatchObject({ itc_blocked: true });

    const second = await withClient((c) => applyIndustryCoa(c, B));
    expect(second.accountsCreated).toEqual([]);
    expect(second.categoriesCreated).toEqual([]);

    const preview = await withClient((c) => previewIndustryCoa(c, B));
    expect(preview!.missingLedgers).toEqual([]);
    expect(preview!.missingCategories).toEqual([]);
  });

  it('leaves a user account on a pack code untouched and unmapped', async () => {
    const B = await newBusiness('garments', 'retail', null);
    await pool.query(
      `INSERT INTO accounts (business_id, account_code, account_name, account_type, account_group_id, nature)
       SELECT $1, '5110', 'My Custom Ledger', 'expense', id, 'debit' FROM account_groups
        WHERE business_id = $1 AND group_code = '5200'`,
      [B]
    );
    const res = await withClient((c) => applyIndustryCoa(c, B));
    expect(res.conflictingCodes).toContain('5110');
    expect(res.accountsCreated).not.toContain('5110');

    const { rows } = await pool.query(
      `SELECT a.account_name, ec.account_id
         FROM expense_categories ec LEFT JOIN accounts a ON a.business_id = ec.business_id AND a.account_code = '5110'
        WHERE ec.business_id = $1 AND ec.name = 'Stitching Job Work'`,
      [B]
    );
    expect(rows[0]).toMatchObject({ account_name: 'My Custom Ledger', account_id: null });
  });

  it('blocks input credit on every category for a standalone restaurant', async () => {
    const B = await newBusiness('food_beverages', 'retail', 'b2c');
    await withClient((c) => applyIndustryCoa(c, B));
    const { rows } = await pool.query(
      `SELECT name, itc_blocked FROM expense_categories WHERE business_id = $1`,
      [B]
    );
    expect(rows.length).toBeGreaterThan(13);
    expect(rows.every((r) => r.itc_blocked)).toBe(true);
    expect(rows.map((r) => r.name)).toEqual(expect.arrayContaining(['Rent', 'Kitchen Consumables', 'Delivery Platform Commission']));
  });

  it('adds only pack categories for an existing business that already has categories', async () => {
    const B = await newBusiness('construction', 'service', null);
    await pool.query(`INSERT INTO expense_categories (business_id, name) VALUES ($1, 'site expenses')`, [B]);
    const res = await withClient((c) => applyIndustryCoa(c, B));
    expect(res.categoriesCreated).not.toContain('Rent');
    expect(res.categoriesCreated).not.toContain('Site Expenses');
    expect(res.categoriesCreated).toEqual(expect.arrayContaining(['Sub-contractor Charges', 'Machinery Hire']));
  });

  it('does nothing before the core chart exists', async () => {
    const B = await newBusiness('textiles', 'manufacturer', null, false);
    const res = await withClient((c) => applyIndustryCoa(c, B));
    expect(res.accountsCreated).toEqual([]);
    expect(res.categoriesCreated).toEqual([]);
  });
});
