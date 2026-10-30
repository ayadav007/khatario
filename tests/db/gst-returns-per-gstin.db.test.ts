/**
 * Returns and filing per GSTIN: the filed-period lock, the GST credit/cash ledgers, unbranched
 * ledger lines, GSTR-2B matching (migration 450) and the compliance "filed" view.
 * PHASE2_TEST_DATABASE_URL=postgresql://…/kh_phase2_test npx jest tests/db/gst-returns-per-gstin.db.test.ts --runInBand
 */
import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import type { Pool } from 'pg';

const url = process.env.PHASE2_TEST_DATABASE_URL;
if (url) process.env.DATABASE_URL = url;
const d = url ? describe : describe.skip;

import { getPool, closePool } from '@/lib/db';
import { withLedgerDelete } from '@/lib/accounting/ledger-delete-guard';
import { isGstPeriodFiled } from '@/lib/gst/gst-filing';
import { getGstBalance, gstSetoffExistsForPeriod } from '@/lib/gst/gst-settlement';
import { getLedgerNetCreditMinusDebit } from '@/lib/gst/gstr3b-ledger';
import { GSTR2BReconciliationEngine } from '@/lib/gst/gstr2b-reconciliation';
import { loadGstFilingOrgDefaults } from '@/lib/gst/gst-org-filing';

const GSTIN_MH = '27AAAPL1234C1ZE';
const GSTIN_KA = '29AAAPL1234C1ZA';
const SUPPLIER = '33ADVFS4469F1ZJ';

d('returns and filing per GSTIN (real DB)', () => {
  jest.setTimeout(120000);
  let pool: Pool;
  const businessId = randomUUID();
  const hq = randomUUID(); // Maharashtra head office, default branch
  const shop = randomUUID(); // second Maharashtra shop, same GSTIN
  const blr = randomUUID(); // Karnataka branch, own GSTIN
  let acc: Record<string, string> = {};

  // One balanced voucher: the GST line plus an offsetting line on a non-GST account (5201).
  const line = (branch: string | null, code: string, debit: number, credit: number, voucherType = 'invoice', date = '2026-08-10', ref: string | null = null) =>
    pool.query(
      `INSERT INTO ledger_entry_lines (business_id, branch_id, account_id, voucher_type, voucher_id, entry_date, debit, credit, reference_number)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $10), ($1, $2, $9, $4, $5, $6, $8, $7, $10)`,
      [businessId, branch, acc[code], voucherType, randomUUID(), date, debit, credit, acc['5201'], ref]
    );

  beforeAll(async () => {
    pool = getPool();
    await pool.query(
      fs.readFileSync(path.join(__dirname, '../../database/migrations/450_gstr2b_recipient_gstin.sql'), 'utf8')
    );
    await pool.query(
      `INSERT INTO businesses (id, name, gstin, state, state_code, gst_registration_type)
       VALUES ($1, 'Per GSTIN Co', $2, 'Maharashtra', '27', 'regular')`,
      [businessId, GSTIN_MH]
    );
    await pool.query(`SELECT create_default_chart_of_accounts($1)`, [businessId]);
    await pool.query(
      `INSERT INTO branches (id, business_id, name, gstin, state, state_code, is_primary, is_default, is_active) VALUES
         ($1, $4, 'Pune HQ', NULL, 'Maharashtra', '27', true, true, true),
         ($2, $4, 'Nashik Shop', NULL, 'Maharashtra', '27', false, false, true),
         ($3, $4, 'Bengaluru', $5, 'Karnataka', '29', false, false, true)`,
      [hq, shop, blr, businessId, GSTIN_KA]
    );
    const rows = await pool.query(`SELECT account_code, id FROM accounts WHERE business_id = $1`, [businessId]);
    acc = Object.fromEntries(rows.rows.map((r) => [r.account_code, r.id]));
  });

  afterAll(async () => {
    await pool.query('DELETE FROM gstr2b_reconciliation WHERE business_id = $1', [businessId]).catch(() => undefined);
    await pool.query('DELETE FROM gstr2b_invoices WHERE business_id = $1', [businessId]);
    await pool.query('DELETE FROM gstr2b_imports WHERE business_id = $1', [businessId]);
    await pool.query('DELETE FROM purchase_items WHERE purchase_id IN (SELECT id FROM purchases WHERE business_id = $1)', [businessId]);
    await pool.query('DELETE FROM purchases WHERE business_id = $1', [businessId]);
    await pool.query('DELETE FROM gst_filings WHERE business_id = $1', [businessId]);
    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      await withLedgerDelete(c, 'tenant_purge', null, async () => {
        await c.query('DELETE FROM ledger_entry_lines WHERE business_id = $1', [businessId]);
      });
      await c.query('COMMIT');
    } catch {
      await c.query('ROLLBACK');
    } finally {
      c.release();
    }
    await closePool();
  });

  it('a filing by one shop locks the period for every shop on the same GSTIN, not for other GSTINs', async () => {
    await pool.query(
      `INSERT INTO gst_filings (business_id, branch_id, gst_period, status, filed_at) VALUES ($1, $2, '2026-08', 'filed', NOW())`,
      [businessId, hq]
    );
    expect(await isGstPeriodFiled(businessId, shop, '2026-08')).toBe(true);
    expect(await isGstPeriodFiled(businessId, blr, '2026-08')).toBe(false);
  });

  it('shares one credit ledger across the shops of a GSTIN and keeps other GSTINs apart', async () => {
    await line(shop, '2152', 0, 900, 'invoice', '2026-08-05'); // output IGST at the Nashik shop
    await line(hq, '1112', 600, 0, 'purchase', '2026-08-06'); // ITC booked at Pune HQ
    await line(blr, '1112', 5000, 0, 'purchase', '2026-08-07'); // Karnataka's own ITC
    expect(await getGstBalance(businessId, '2152', '2026-08-31', hq)).toBe(900);
    expect(await getGstBalance(businessId, '1112', '2026-08-31', shop)).toBe(600);
    expect(await getGstBalance(businessId, '1112', '2026-08-31', blr)).toBe(5000);
  });

  it('a set-off posted by one shop counts for the whole GSTIN', async () => {
    await line(hq, '2152', 600, 0, 'gst_setoff', '2026-08-31', 'GST_SETOFF|2026-08|x');
    expect(await gstSetoffExistsForPeriod(businessId, shop, '2026-08')).toBe(true);
    expect(await gstSetoffExistsForPeriod(businessId, blr, '2026-08')).toBe(false);
  });

  it('counts ledger lines without a branch only in the head office GSTIN', async () => {
    await line(null, '2151', 0, 250, 'journal', '2026-09-03');
    expect(await getLedgerNetCreditMinusDebit(businessId, '2151', '2026-09-01', '2026-09-30', [hq, shop])).toBe(250);
    expect(await getLedgerNetCreditMinusDebit(businessId, '2151', '2026-09-01', '2026-09-30', [blr])).toBe(0);
  });

  it('matches a 2B row only to a purchase booked under the GSTIN it was issued to', async () => {
    const purchase = async (branch: string, bill: string) => {
      const p = await pool.query(
        `INSERT INTO purchases (business_id, branch_id, supplier_gstin, bill_number, bill_date, status, subtotal, igst_total, grand_total)
         VALUES ($1, $2, $3, $4, '2026-08-12', 'final', 1000, 180, 1180) RETURNING id`,
        [businessId, branch, SUPPLIER, bill]
      );
      await pool.query(
        `INSERT INTO purchase_items (purchase_id, item_name, quantity, unit_price, line_total, taxable_value, igst_amount, cgst_amount, sgst_amount, tax_rate)
         VALUES ($1, 'Widget', 1, 1000, 1180, 1000, 180, 0, 0, 18)`,
        [p.rows[0].id]
      );
      return p.rows[0].id as string;
    };
    const atHq = await purchase(hq, 'S-100');
    const atBlr = await purchase(blr, 'S-200');
    // Both bills appear in the Karnataka GSTIN's 2B only.
    const imp = await pool.query(
      `INSERT INTO gstr2b_imports (business_id, filing_period, recipient_gstin) VALUES ($1, '2026-08', $2) RETURNING id`,
      [businessId, GSTIN_KA]
    );
    for (const bill of ['S-100', 'S-200']) {
      await pool.query(
        `INSERT INTO gstr2b_invoices (import_id, business_id, filing_period, supplier_gstin, invoice_number, invoice_date,
           document_type, taxable_value, igst_amount, cgst_amount, sgst_amount, cess_amount, itc_eligibility, recipient_gstin)
         VALUES ($1, $2, '2026-08', $3, $4, '2026-08-12', 'invoice', 1000, 180, 0, 0, 0, 'eligible', $5)`,
        [imp.rows[0].id, businessId, SUPPLIER, bill, GSTIN_KA]
      );
    }
    await new GSTR2BReconciliationEngine().reconcile(businessId, '2026-08');
    const r = await pool.query(
      `SELECT purchase_id, match_status FROM gstr2b_reconciliation WHERE business_id = $1 AND purchase_id IS NOT NULL`,
      [businessId]
    );
    const status = Object.fromEntries(r.rows.map((x) => [x.purchase_id, x.match_status]));
    expect(status[atBlr]).toBe('MATCHED');
    expect(status[atHq]).not.toBe('MATCHED');
  });

  it('takes the QRMP due day from the GSTIN state', async () => {
    expect((await loadGstFilingOrgDefaults(businessId, blr)).qrmpDueDay).toBe(22);
    await pool.query(`UPDATE branches SET state = 'Punjab', state_code = '03', gstin = NULL WHERE id = $1`, [blr]);
    await pool.query(`UPDATE businesses SET state = 'Punjab', state_code = '03', gstin = NULL WHERE id = $1`, [businessId]);
    expect((await loadGstFilingOrgDefaults(businessId, hq)).qrmpDueDay).toBe(24);
  });
});
