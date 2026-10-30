/**
 * Multi-GSTIN businesses: GSTR-1 filing rows per GSTIN (migration 446) and one invoice series per
 * GSTIN (migration 447 + findSharedSeriesPrefix).
 * PHASE2_TEST_DATABASE_URL=postgresql://…/kh_phase2_test npx jest tests/db/gst-multi-gstin-series.db.test.ts --runInBand
 */
import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import type { Pool } from 'pg';

const url = process.env.PHASE2_TEST_DATABASE_URL;
if (url) process.env.DATABASE_URL = url;
const d = url ? describe : describe.skip;

import { getPool, closePool } from '@/lib/db';
import { registrationBranchIds, registrationGstinKey } from '@/lib/gst/registration';
import { findSharedSeriesPrefix } from '@/lib/invoices/document-counter';

const GSTIN_KA = '29AAACR5055K1ZO';
const GSTIN_TN = '33ADVFS4469F1ZJ';

const sql = (name: string) => fs.readFileSync(path.join(__dirname, '../../database/migrations', name), 'utf8');

d('one GSTR-1 and one invoice series per GSTIN (real DB)', () => {
  jest.setTimeout(120000);
  let pool: Pool;
  const businessId = randomUUID();
  const hq = randomUUID();
  const shop = randomUUID(); // second Karnataka shop, no GSTIN of its own, already has invoices
  const hosur = randomUUID(); // Tamil Nadu branch with its own GSTIN
  const legacyFiling = randomUUID();

  beforeAll(async () => {
    pool = getPool();
    await pool.query(
      `INSERT INTO businesses (id, name, gstin, state_code, gst_registration_type) VALUES ($1, 'Multi GSTIN Co', $2, '29', 'regular')`,
      [businessId, GSTIN_KA]
    );
    await pool.query(
      `INSERT INTO branches (id, business_id, name, branch_code, gstin, state_code, is_primary, is_default, is_active) VALUES
         ($1, $4, 'Bangalore HQ', 'BLR', NULL, '29', true, true, true),
         ($2, $4, 'Jayanagar Shop', 'JNR', NULL, '29', false, false, true),
         ($3, $4, 'Hosur', 'HSR', $5, '33', false, false, true)`,
      [hq, shop, hosur, businessId, GSTIN_TN]
    );
    // A filing made before migration 446, built for the Hosur branch.
    await pool.query('ALTER TABLE gstr1_filings DROP COLUMN IF EXISTS gstin');
    await pool.query(
      `INSERT INTO gstr1_filings (id, business_id, filing_period, filing_date, status, gstr1_snapshot)
       VALUES ($1, $2, '2026-08', '2026-09-10', 'filed', $3::jsonb)`,
      [legacyFiling, businessId, JSON.stringify({ branch_id: hosur })]
    );
    await pool.query(sql('446_gstr1_filing_per_gstin.sql'));
    await pool.query(sql('447_branch_series_prefix_per_gstin.sql'));
  });

  afterAll(async () => {
    await pool.query('DELETE FROM gstr1_filings WHERE business_id = $1', [businessId]);
    await pool.query('DELETE FROM branch_document_prefixes WHERE branch_id = ANY($1::uuid[])', [[hq, shop, hosur]]);
    await pool.query('DELETE FROM branches WHERE business_id = $1', [businessId]);
    await pool.query('DELETE FROM businesses WHERE id = $1', [businessId]);
    await closePool();
  });

  it('backfills an old filing with the GSTIN of the branch it was built for', async () => {
    const r = await pool.query('SELECT gstin FROM gstr1_filings WHERE id = $1', [legacyFiling]);
    expect(r.rows[0].gstin).toBe(GSTIN_TN);
  });

  it('lets Karnataka and Tamil Nadu each keep a GSTR-1 for the same month, but not two for one GSTIN', async () => {
    const ka = await registrationGstinKey(pool, businessId, shop);
    expect(ka).toBe(GSTIN_KA);
    await pool.query(
      `INSERT INTO gstr1_filings (business_id, gstin, filing_period, filing_date, status) VALUES ($1, $2, '2026-08', '2026-09-11', 'draft')`,
      [businessId, ka]
    );
    await expect(
      pool.query(
        `INSERT INTO gstr1_filings (business_id, gstin, filing_period, filing_date, status) VALUES ($1, $2, '2026-08', '2026-09-11', 'draft')`,
        [businessId, GSTIN_TN]
      )
    ).rejects.toThrow(/uq_gstr1_filings_business_gstin_period/);
  });

  it('groups branches by the GSTIN they file under', async () => {
    expect((await registrationBranchIds(pool, businessId, shop)).sort()).toEqual([hq, shop].sort());
    expect(await registrationBranchIds(pool, businessId, hosur)).toEqual([hosur]);
  });

  it('gives the shop sharing the head office GSTIN its own prefixes, and leaves the others alone', async () => {
    const r = await pool.query(
      'SELECT branch_id, document_type, prefix FROM branch_document_prefixes WHERE branch_id = ANY($1::uuid[]) ORDER BY document_type',
      [[hq, shop, hosur]]
    );
    expect(r.rows.filter((x) => x.branch_id === shop).map((x) => [x.document_type, x.prefix])).toEqual([
      ['bill_of_supply', 'BOS-JNR'],
      ['tax_invoice', 'INV-JNR'],
    ]);
    expect(r.rows.filter((x) => x.branch_id !== shop)).toEqual([]);
  });

  it('refuses a prefix that would put two branches on one GSTIN in the same series', async () => {
    expect(await findSharedSeriesPrefix(pool, businessId, 'tax_invoice', 'INV', [shop])).toEqual(['Bangalore HQ', 'Jayanagar Shop']);
    // Hosur is on its own GSTIN, so it may reuse the head office prefix.
    expect(await findSharedSeriesPrefix(pool, businessId, 'tax_invoice', 'INV', [hosur])).toBeNull();
    // Applying one prefix to every branch (no branch_ids) is caught too.
    expect(await findSharedSeriesPrefix(pool, businessId, 'bill_of_supply', 'BS', [hq, shop, hosur])).not.toBeNull();
  });
});
