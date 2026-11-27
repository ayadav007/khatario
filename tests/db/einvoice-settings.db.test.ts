/**
 * e-invoice coverage settings, the monthly limit and migration 478.
 * Runs only when PHASE2_TEST_DATABASE_URL is set, and writes only after current_database()
 * is kh_phase2_test.
 */
import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import type { Pool } from 'pg';

const url = process.env.PHASE2_TEST_DATABASE_URL;
if (url) process.env.DATABASE_URL = url;
const d = url ? describe : describe.skip;

import { getPool, closePool } from '@/lib/db';
import { buildLimitCountQuery, LIMIT_KEY_BY_TYPE } from '@/lib/subscription/limit-registry';
import {
  einvoiceApplies,
  einvoiceFromFor,
  listEinvoiceRegistrations,
  setEinvoiceFrom,
} from '@/lib/gst/einvoice-settings';

d('e-invoice settings (kh_phase2_test)', () => {
  jest.setTimeout(120000);

  let pool: Pool;
  const tag = randomUUID().slice(0, 8);
  const businessId = randomUUID();
  const otherBusinessId = randomUUID();
  const branch1Id = randomUUID(); // no GSTIN
  const branch2Id = randomUUID(); // own GSTIN
  const branch3Id = randomUUID(); // same GSTIN as the business, lower case
  const inactiveBranchId = randomUUID(); // own GSTIN but inactive
  const otherBranchId = randomUUID();
  const A = '29ABCDE1234F1Z5';
  const B = '27ABCDE1234F1Z6';
  const C = '33ABCDE1234F1Z7';

  beforeAll(async () => {
    pool = getPool();
    const info = await pool.query<{ db: string }>('SELECT current_database() AS db');
    if (info.rows[0]?.db !== 'kh_phase2_test') throw new Error(`Refusing to mutate database ${info.rows[0]?.db}`);
    const sql = fs.readFileSync(path.resolve(process.cwd(), 'database/migrations/478_einvoice_irn.sql'), 'utf8');
    await pool.query(sql);
    await pool.query(sql); // safe to run twice

    for (const [id, name, gstin] of [
      [businessId, `Einv A ${tag}`, A],
      [otherBusinessId, `Einv B ${tag}`, C],
    ]) {
      await pool.query(
        `INSERT INTO businesses (id, name, gstin, state, state_code, gst_registration_type, primary_module)
         VALUES ($1, $2, $3, 'Karnataka', '29', 'regular', 'billing')`,
        [id, name, gstin],
      );
    }
    const br = (id: string, biz: string, name: string, gstin: string | null, active = true) =>
      pool.query(
        `INSERT INTO branches (id, business_id, name, gstin, state_code, is_active) VALUES ($1, $2, $3, $4, '29', $5)`,
        [id, biz, name, gstin, active],
      );
    await br(branch1Id, businessId, 'Branch 1', null);
    await br(branch2Id, businessId, 'Branch 2', B);
    await br(branch3Id, businessId, 'Branch 3', A.toLowerCase());
    await br(inactiveBranchId, businessId, 'Closed', '07ABCDE1234F1Z8', false);
    await br(otherBranchId, otherBusinessId, 'Other', C);
  });

  afterAll(async () => {
    if (pool) {
      await pool.query('DELETE FROM branches WHERE business_id = ANY($1::uuid[])', [[businessId, otherBusinessId]]);
      await pool.query('DELETE FROM businesses WHERE id = ANY($1::uuid[])', [[businessId, otherBusinessId]]);
    }
    await closePool();
  });

  it('lists the business GSTIN and only branches with a different GSTIN', async () => {
    const regs = await listEinvoiceRegistrations(pool, businessId);
    expect(regs.map((r) => r.gstin)).toEqual([A, B]);
    expect(regs.map((r) => r.key)).toEqual(['business', branch2Id]);
    expect(regs.map((r) => r.label)).toEqual([`Einv A ${tag}`, 'Branch 2']);
  });

  it('lists nothing for a business without a GSTIN', async () => {
    const id = randomUUID();
    await pool.query(
      `INSERT INTO businesses (id, name, state, state_code, primary_module) VALUES ($1, $2, 'Karnataka', '29', 'billing')`,
      [id, `No gstin ${tag}`],
    );
    try {
      expect(await listEinvoiceRegistrations(pool, id)).toEqual([]);
    } finally {
      await pool.query('DELETE FROM businesses WHERE id = $1', [id]);
    }
  });

  it('resolves the start date by the registration a branch issues under', async () => {
    await setEinvoiceFrom(pool, businessId, 'business', '2026-04-01');
    await setEinvoiceFrom(pool, businessId, branch2Id, '2026-10-01');
    expect(await einvoiceFromFor(pool, businessId, null)).toBe('2026-04-01');
    expect(await einvoiceFromFor(pool, businessId, branch1Id)).toBe('2026-04-01');
    expect(await einvoiceFromFor(pool, businessId, branch3Id)).toBe('2026-04-01');
    expect(await einvoiceFromFor(pool, businessId, branch2Id)).toBe('2026-10-01');
    const regs = await listEinvoiceRegistrations(pool, businessId);
    expect(regs.map((r) => r.einvoice_from)).toEqual(['2026-04-01', '2026-10-01']);
    await setEinvoiceFrom(pool, businessId, branch2Id, null);
    expect(await einvoiceFromFor(pool, businessId, branch2Id)).toBeNull();
  });

  it('rejects a branch of another business', async () => {
    await expect(setEinvoiceFrom(pool, businessId, otherBranchId, '2026-04-01')).rejects.toThrow();
    const r = await pool.query('SELECT einvoice_from FROM branches WHERE id = $1', [otherBranchId]);
    expect(r.rows[0].einvoice_from).toBeNull();
  });

  it('rejects an unknown key, a branch without its own GSTIN and a bad date', async () => {
    await expect(setEinvoiceFrom(pool, businessId, 'nope', '2026-04-01')).rejects.toThrow(Error);
    await expect(setEinvoiceFrom(pool, businessId, branch1Id, '2026-04-01')).rejects.toThrow(Error);
    await expect(setEinvoiceFrom(pool, businessId, branch3Id, '2026-04-01')).rejects.toThrow(Error);
    await expect(setEinvoiceFrom(pool, businessId, 'business', '01/04/2026')).rejects.toThrow(Error);
    await expect(setEinvoiceFrom(pool, businessId, 'business', '2026-02-31')).rejects.toThrow(Error);
  });

  it('applies only to final B2B-type tax invoices on or after the start date', () => {
    const base = { status: 'final', document_type: 'tax_invoice', supply_type: 'b2b', invoice_date: '2026-11-01' };
    expect(einvoiceApplies(base, '2026-04-01')).toBe(true);
    expect(einvoiceApplies(base, null)).toBe(false);
    expect(einvoiceApplies({ ...base, supply_type: 'b2c_small' }, '2026-04-01')).toBe(false);
    expect(einvoiceApplies({ ...base, document_type: 'bill_of_supply' }, '2026-04-01')).toBe(false);
    expect(einvoiceApplies({ ...base, document_type: 'proforma_invoice' }, '2026-04-01')).toBe(false);
    expect(einvoiceApplies({ ...base, invoice_date: '2026-03-31' }, '2026-04-01')).toBe(false);
    expect(einvoiceApplies({ ...base, status: 'draft' }, '2026-04-01')).toBe(false);
    expect(einvoiceApplies({ ...base, supply_type: 'export', document_type: null }, '2026-04-01')).toBe(true);
  });

  it('gives each plan a monthly e-invoice limit by whether it has the e_invoice feature', async () => {
    const rows = await pool.query<{ plan_id: string; limit_value: number; has: boolean }>(
      `SELECT sp.id AS plan_id, l.limit_value,
              EXISTS (SELECT 1 FROM subscription_plan_features f
                       WHERE f.plan_id = sp.id AND f.feature_id = 'e_invoice' AND f.enabled) AS has
         FROM subscription_plans sp
         JOIN subscription_plan_limits l ON l.plan_id = sp.id AND l.limit_key = 'max_einvoices_per_month'`,
    );
    expect(rows.rows.length).toBeGreaterThan(0);
    for (const r of rows.rows) expect(r.limit_value).toBe(r.has ? -1 : 0);
  });

  it('counts e-invoices issued this month', async () => {
    expect(LIMIT_KEY_BY_TYPE.einvoices).toBe('max_einvoices_per_month');
    const q = buildLimitCountQuery('einvoices', businessId);
    const r = await pool.query<{ count: number }>(q.sql, q.params);
    expect(r.rows[0].count).toBe(0);
  });
});
