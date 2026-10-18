/**
 * A purchase with no supplier bill number must not abort GSTR-2B reconciliation.
 * Runs only when PHASE2_TEST_DATABASE_URL points at kh_phase2_test. Fixtures are
 * committed so the engine's own connection can see them, then the business is deleted.
 */
import { randomUUID } from 'crypto';

const url = process.env.PHASE2_TEST_DATABASE_URL;
if (url) process.env.DATABASE_URL = url;
const d = url ? describe : describe.skip;

import { getPool, closePool } from '@/lib/db';
import { GSTR2BReconciliationEngine } from '@/lib/gst/gstr2b-reconciliation';

d('GSTR-2B reconciliation with missing invoice numbers (real DB)', () => {
  jest.setTimeout(60000);

  const B = randomUUID();
  const BR = randomUUID();
  const SUPP = randomUUID();
  const GSTIN = '29G2BTS1001A1ZJ';
  const PERIOD = '2026-09';
  let importId = '';

  async function purchase(bill: string | null, taxable: number, date = '2026-09-15') {
    const id = randomUUID();
    const half = Math.round(taxable * 9) / 100;
    const pool = getPool();
    await pool.query(
      `INSERT INTO purchases (id, business_id, supplier_id, bill_number, bill_date, status, place_of_supply_state_code,
          is_reverse_charge, itc_eligible, subtotal, tax_total, cgst_total, sgst_total, igst_total, grand_total,
          paid_amount, balance_amount, payment_status, branch_id, supplier_gstin, document_type)
       VALUES ($1, $2, $3, $4, $5, 'final', '29', false, true, $6, $7, $8, $8, 0, $9, 0, $9, 'unpaid', $10, $11, 'tax_invoice')`,
      [id, B, SUPP, bill, date, taxable, 2 * half, half, taxable + 2 * half, BR, GSTIN]
    );
    await pool.query(
      `INSERT INTO purchase_items (purchase_id, item_name, quantity, unit_price, taxable_value, tax_rate, tax_amount,
          cgst_amount, sgst_amount, line_total)
       VALUES ($1, 'Service', 1, $2, $2, 18, $3, $4, $4, $5)`,
      [id, taxable, 2 * half, half, taxable + 2 * half]
    );
    return id;
  }

  async function statement(no: string, taxable: number, date = '2026-09-15', type = 'invoice') {
    const half = Math.round(taxable * 9) / 100;
    await getPool().query(
      `INSERT INTO gstr2b_invoices (import_id, business_id, filing_period, supplier_gstin, invoice_number, invoice_date,
          document_type, taxable_value, igst_amount, cgst_amount, sgst_amount, cess_amount, itc_eligibility)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 0, $9, $9, 0, 'eligible')`,
      [importId, B, PERIOD, GSTIN, no, date, type, taxable, half]
    );
  }

  beforeAll(async () => {
    const pool = getPool();
    await pool.query(
      `INSERT INTO businesses (id, name, gstin, state_code, gst_registration_type)
       VALUES ($1, 'G2B missing invoice', '29AAAPA1234A1Z5', '29', 'regular')`,
      [B]
    );
    await pool.query(
      `INSERT INTO branches (id, business_id, name, state_code, is_primary, is_default, is_active)
       VALUES ($1, $2, 'Main', '29', true, true, true)`,
      [BR, B]
    );
    await pool.query(
      `INSERT INTO suppliers (id, business_id, name, state_code, gstin, current_balance)
       VALUES ($1, $2, 'G2B supplier', '29', $3, 0)`,
      [SUPP, B, GSTIN]
    );
    importId = randomUUID();
    await pool.query(
      `INSERT INTO gstr2b_imports (id, business_id, filing_period, file_hash, total_invoices)
       VALUES ($1, $2, $3, $4, 1)`,
      [importId, B, PERIOD, randomUUID().replace(/-/g, '')]
    );
  });

  afterAll(async () => {
    await getPool().query('DELETE FROM businesses WHERE id = $1', [B]);
    await closePool();
  });

  test('valid invoice numbers match and a second run does not duplicate rows', async () => {
    const engine = new GSTR2BReconciliationEngine();
    await purchase('G2B-VALID', 1000);
    await statement('G2B-VALID', 1000);
    const first = await engine.reconcile(B, PERIOD);
    expect(first.missing_references).toEqual([]);
    expect(first.matches.map((row) => row.match_status)).toEqual(['MATCHED']);
    const ids = (await getPool().query(
      `SELECT id FROM gstr2b_reconciliation WHERE business_id = $1 AND filing_period = $2`,
      [B, PERIOD]
    )).rows.map((row) => row.id);
    expect(ids).toHaveLength(1);
    await engine.reconcile(B, PERIOD);
    const again = (await getPool().query(
      `SELECT id FROM gstr2b_reconciliation WHERE business_id = $1 AND filing_period = $2`,
      [B, PERIOD]
    )).rows.map((row) => row.id);
    expect(again).toEqual(ids);
  });

  test('null, blank and several missing bill numbers are reported and left unchanged', async () => {
    const engine = new GSTR2BReconciliationEngine();
    const nullId = await purchase(null, 400);
    const blankId = await purchase('   ', 500);
    const extraId = await purchase('', 600);
    const numberedId = await purchase('G2B-KEEP', 2000);
    await statement('G2B-KEEP', 2000);
    await statement('   ', 100);
    const before = await getPool().query(
      `SELECT id, bill_number, subtotal, status FROM purchases WHERE id = ANY($1::uuid[]) ORDER BY id`,
      [[nullId, blankId, extraId, numberedId]]
    );

    const result = await engine.reconcile(B, PERIOD);
    const reported = result.missing_references.filter((row) => row.source === 'books').map((row) => row.purchase_id);
    expect(reported).toEqual(expect.arrayContaining([nullId, blankId, extraId]));
    expect(reported).not.toContain(numberedId);
    expect(result.missing_references.some((row) => row.source === 'gstr2b' && row.reason === 'missing_invoice_number')).toBe(true);

    const kept = result.matches.find((row) => row.invoice_number === 'G2B-KEEP');
    expect(kept?.match_status).toBe('MATCHED');
    const storedNumbers = (await getPool().query(
      `SELECT invoice_number FROM gstr2b_reconciliation WHERE business_id = $1`,
      [B]
    )).rows.map((row) => row.invoice_number);
    expect(storedNumbers.every((no: string) => String(no).trim() !== '')).toBe(true);
    expect(storedNumbers).not.toContain(null);

    const after = await getPool().query(
      `SELECT id, bill_number, subtotal, status FROM purchases WHERE id = ANY($1::uuid[]) ORDER BY id`,
      [[nullId, blankId, extraId, numberedId]]
    );
    expect(after.rows).toEqual(before.rows);
  });

  test('a normalization match does not attach a different invoice number', async () => {
    const engine = new GSTR2BReconciliationEngine();
    await purchase('g2b-09 / a', 1500);
    await purchase('G2B-09B', 1500);
    await statement('G2B09A', 1500);
    const result = await engine.reconcile(B, PERIOD);
    const spaced = result.matches.find((row) => row.invoice_number === 'g2b-09 / a');
    const other = result.matches.find((row) => row.invoice_number === 'G2B-09B');
    expect(spaced?.match_status).toBe('MATCHED');
    expect(other?.match_status).toBe('MISSING_IN_2B');
  });

  test('a database error rolls the reconciliation write back', async () => {
    const other = randomUUID();
    const branch = randomUUID();
    const supplier = randomUUID();
    const pool = getPool();
    await pool.query(
      `INSERT INTO businesses (id, name, gstin, state_code, gst_registration_type)
       VALUES ($1, 'G2B rollback', '29AAAPA1234A1Z6', '29', 'regular')`,
      [other]
    );
    await pool.query(
      `INSERT INTO branches (id, business_id, name, state_code, is_primary, is_default, is_active)
       VALUES ($1, $2, 'Main', '29', true, true, true)`,
      [branch, other]
    );
    await pool.query(
      `INSERT INTO suppliers (id, business_id, name, state_code, gstin, current_balance)
       VALUES ($1, $2, 'G2B supplier', '29', $3, 0)`,
      [supplier, other, GSTIN]
    );
    const longNo = 'G'.repeat(60);
    const id = randomUUID();
    await pool.query(
      `INSERT INTO purchases (id, business_id, supplier_id, bill_number, bill_date, status, place_of_supply_state_code,
          is_reverse_charge, itc_eligible, subtotal, tax_total, cgst_total, sgst_total, igst_total, grand_total,
          paid_amount, balance_amount, payment_status, branch_id, supplier_gstin, document_type)
       VALUES ($1, $2, $3, $4, '2026-09-15', 'final', '29', false, true, 100, 18, 9, 9, 0, 118, 0, 118, 'unpaid', $5, $6, 'tax_invoice')`,
      [id, other, supplier, longNo, branch, GSTIN]
    );
    await pool.query(
      `INSERT INTO purchase_items (purchase_id, item_name, quantity, unit_price, taxable_value, tax_rate, tax_amount, cgst_amount, sgst_amount, line_total)
       VALUES ($1, 'Service', 1, 100, 100, 18, 18, 9, 9, 118)`,
      [id]
    );
    await expect(new GSTR2BReconciliationEngine().reconcile(other, PERIOD)).rejects.toThrow();
    const rows = await pool.query(`SELECT COUNT(*)::int AS n FROM gstr2b_reconciliation WHERE business_id = $1`, [other]);
    expect(rows.rows[0].n).toBe(0);
    const bill = await pool.query(`SELECT bill_number, status FROM purchases WHERE id = $1`, [id]);
    expect(bill.rows[0]).toEqual({ bill_number: longNo, status: 'final' });
    await pool.query('DELETE FROM businesses WHERE id = $1', [other]);
  });
});
