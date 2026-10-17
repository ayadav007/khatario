/**
 * Decision retention and duplicate-bill audit on the disposable database.
 * PHASE2_TEST_DATABASE_URL=postgresql://…/kh_phase2_test npx jest tests/db/gst-decision-retention.db.test.ts --runInBand
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
import { GSTR2BReconciliationEngine } from '@/lib/gst/gstr2b-reconciliation';

d('GST decision history and override audit (real DB)', () => {
  jest.setTimeout(120000);
  let pool: Pool;
  const businessId = randomUUID();
  const branchId = randomUUID();
  const userId = randomUUID();
  const supplierId = randomUUID();
  const tag = businessId.slice(0, 8);

  const migration = fs.readFileSync(
    path.join(__dirname, '../../database/migrations/397_gst_audit_retention.sql'),
    'utf8'
  );

  function match(partial: Record<string, unknown>) {
    return {
      match_status: 'MATCHED',
      supplier_gstin: '27AAPFU0939F1ZV',
      invoice_number: 'BILL-1',
      invoice_date: '2026-04-10',
      document_type: 'invoice',
      books_taxable_value: 1000,
      books_igst: 180,
      books_cgst: 0,
      books_sgst: 0,
      books_cess: 0,
      books_itc_amount: 180,
      gstr2b_taxable_value: 1000,
      gstr2b_igst: 180,
      gstr2b_cgst: 0,
      gstr2b_sgst: 0,
      gstr2b_cess: 0,
      gstr2b_itc_eligibility: 'Y',
      difference_taxable_value: 0,
      difference_igst: 0,
      difference_cgst: 0,
      difference_sgst: 0,
      difference_cess: 0,
      is_import_goods: false,
      is_import_services: false,
      is_credit_note: false,
      ...partial,
    };
  }

  async function save(period: string, rows: ReturnType<typeof match>[]) {
    const engine = new GSTR2BReconciliationEngine();
    const client = await pool.connect();
    try {
      await (engine as unknown as {
        storeReconciliationRecords: (c: unknown, b: string, p: string, m: unknown[]) => Promise<void>;
      }).storeReconciliationRecords(client, businessId, period, rows);
    } finally {
      client.release();
    }
  }

  beforeAll(async () => {
    pool = getPool();
    await pool.query(migration);
    await pool.query(
      `INSERT INTO businesses (id, name, gstin, state_code, gst_registration_type)
       VALUES ($1, $2, $3, '27', 'regular')`,
      [businessId, `GstRet ${tag}`, `27${tag.toUpperCase().padEnd(10, 'A').slice(0, 10)}1Z5`]
    );
    await pool.query(
      `INSERT INTO branches (id, business_id, name, state_code, is_primary, is_default, is_active)
       VALUES ($1, $2, 'Main', '27', true, true, true)`,
      [branchId, businessId]
    );
    await pool.query(
      `INSERT INTO users (id, business_id, name, phone, is_primary_admin)
       VALUES ($1, $2, 'Clerk', $3, true)`,
      [userId, businessId, `98${Date.now().toString().slice(-8)}`]
    );
    await pool.query(
      `INSERT INTO suppliers (id, business_id, name) VALUES ($1, $2, 'Supplier')`,
      [supplierId, businessId]
    );
  });

  afterAll(async () => {
    if (!pool) return;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await withLedgerDelete(client, 'tenant_purge', userId, async () => {
        await client.query(`DELETE FROM businesses WHERE id = $1`, [businessId]);
      });
      await client.query('COMMIT');
    } catch {
      await client.query('ROLLBACK').catch(() => {});
    } finally {
      client.release();
      await closePool();
    }
  });

  it('keeps a decision on an unchanged re-import and archives it when the tax changes', async () => {
    const id = randomUUID();
    await pool.query(
      `INSERT INTO gstr2b_reconciliation (
         id, business_id, filing_period, match_status, supplier_gstin, invoice_number, invoice_date, document_type,
         books_igst, gstr2b_igst, gstr2b_itc_eligibility
       ) VALUES ($1, $2, '2026-04', 'MATCHED', '27AAPFU0939F1ZV', 'BILL-1', '2026-04-10', 'invoice', 180, 180, 'Y')`,
      [id, businessId]
    );
    await pool.query(
      `INSERT INTO reconciliation_decisions (reconciliation_id, business_id, decision, decided_by_user_id, remarks)
       VALUES ($1, $2, 'IGNORE', $3, 'keep')`,
      [id, businessId, userId]
    );

    await save('2026-04', [match({})]);
    const kept = await pool.query(`SELECT decision FROM reconciliation_decisions WHERE reconciliation_id = $1`, [id]);
    expect(kept.rows.map((row) => row.decision)).toEqual(['IGNORE']);
    const untouched = await pool.query(
      `SELECT COUNT(*)::int AS n FROM reconciliation_decision_history WHERE reconciliation_id = $1`,
      [id]
    );
    expect(untouched.rows[0].n).toBe(0);

    await save('2026-04', [match({ books_igst: 680, difference_igst: 500 })]);
    const detached = await pool.query(`SELECT decision FROM reconciliation_decisions WHERE reconciliation_id = $1`, [id]);
    expect(detached.rows).toHaveLength(0);
    const history = await pool.query(
      `SELECT decision, invoice_number, retention_reason, books_igst::float8 AS books_igst
         FROM reconciliation_decision_history WHERE reconciliation_id = $1`,
      [id]
    );
    expect(history.rows).toEqual([
      { decision: 'IGNORE', invoice_number: 'BILL-1', retention_reason: 'tax', books_igst: 180 },
    ]);

    await pool.query(`DELETE FROM gstr2b_reconciliation WHERE id = $1`, [id]);
    const survived = await pool.query(
      `SELECT invoice_number FROM reconciliation_decision_history WHERE reconciliation_id = $1`,
      [id]
    );
    expect(survived.rows[0].invoice_number).toBe('BILL-1');
  });

  it('does not move a decision onto a different invoice or a different filing period', async () => {
    const oldId = randomUUID();
    await pool.query(
      `INSERT INTO gstr2b_reconciliation (
         id, business_id, filing_period, match_status, supplier_gstin, invoice_number, invoice_date, document_type, books_igst
       ) VALUES ($1, $2, '2026-03', 'MATCHED', '27AAPFU0939F1ZV', 'OLD', '2026-03-15', 'invoice', 90)`,
      [oldId, businessId]
    );
    await pool.query(
      `INSERT INTO reconciliation_decisions (reconciliation_id, business_id, decision, decided_by_user_id)
       VALUES ($1, $2, 'ITC_NOT_ELIGIBLE', $3)`,
      [oldId, businessId, userId]
    );
    await save('2026-04', [match({ invoice_number: 'NEW', invoice_date: '2026-04-02' })]);
    const still = await pool.query(`SELECT decision FROM reconciliation_decisions WHERE reconciliation_id = $1`, [oldId]);
    expect(still.rows[0].decision).toBe('ITC_NOT_ELIGIBLE');
    const copied = await pool.query(
      `SELECT d.decision
         FROM reconciliation_decisions d
         JOIN gstr2b_reconciliation r ON r.id = d.reconciliation_id
        WHERE r.business_id = $1 AND r.invoice_number = 'NEW'`,
      [businessId]
    );
    expect(copied.rows).toHaveLength(0);
  });

  it('keeps the duplicate-bill audit after the purchase is deleted', async () => {
    const index = await pool.query(
      `SELECT 1 FROM pg_indexes WHERE indexname = 'idx_recon_decision_history_reconciliation'`
    );
    expect(index.rows).toHaveLength(1);

    const existingId = randomUUID();
    const purchaseId = randomUUID();
    await pool.query(
      `INSERT INTO purchases (id, business_id, branch_id, supplier_id, bill_number, bill_date, status, grand_total, paid_amount, balance_amount, payment_status)
       VALUES ($1, $2, $3, $4, 'OLD-BILL', '2026-04-01', 'draft', 100, 0, 100, 'unpaid'),
              ($5, $2, $3, $4, 'NEW-BILL', '2026-04-02', 'draft', 100, 0, 100, 'unpaid')`,
      [existingId, businessId, branchId, supplierId, purchaseId]
    );
    const overrideId = randomUUID();
    await pool.query(
      `INSERT INTO purchase_duplicate_overrides (
         id, business_id, purchase_id, existing_purchase_id, reason, created_by,
         purchase_bill_number, purchase_bill_date, existing_bill_number, existing_bill_date, supplier_name
       ) VALUES ($1, $2, $3, $4, 'second copy', $5, 'NEW-BILL', '2026-04-02', 'OLD-BILL', '2026-04-01', 'Supplier')`,
      [overrideId, businessId, purchaseId, existingId, userId]
    );
    await pool.query(`DELETE FROM purchases WHERE id = $1`, [purchaseId]);
    const row = await pool.query(
      `SELECT purchase_id, purchase_bill_number, existing_bill_number, reason
         FROM purchase_duplicate_overrides WHERE id = $1`,
      [overrideId]
    );
    expect(row.rows[0]).toEqual({
      purchase_id: null,
      purchase_bill_number: 'NEW-BILL',
      existing_bill_number: 'OLD-BILL',
      reason: 'second copy',
    });
  });
});
