/**
 * Supplier credit and debit notes reconcile against GSTR-2B notes, not invoices
 * and not purchase returns. Runs only when PHASE2_TEST_DATABASE_URL points at kh_phase2_test.
 */
import { randomUUID } from 'crypto';

const url = process.env.PHASE2_TEST_DATABASE_URL;
if (url) process.env.DATABASE_URL = url;
const d = url ? describe : describe.skip;

import { getPool, closePool } from '@/lib/db';
import { GSTR2BReconciliationEngine } from '@/lib/gst/gstr2b-reconciliation';
import { createPurchaseLedgerEntries, createPurchaseReturnLedgerEntries } from '@/lib/ledger-utils';

d('GSTR-2B supplier credit and debit notes (real DB)', () => {
  jest.setTimeout(90000);

  const B = randomUUID();
  const BR = randomUUID();
  const SUPP = randomUUID();
  const USER = randomUUID();
  const GSTIN = '29G2BTS1001A1ZJ';
  const OTHER = '27AAAAA0000A1Z5';
  const PERIOD = '2026-07';
  let importId = '';

  async function purchase(opts: {
    bill: string;
    taxable: number;
    cgst?: number;
    sgst?: number;
    date?: string;
    type?: string;
    gstin?: string;
    original?: string;
  }) {
    const id = randomUUID();
    const cgst = opts.cgst ?? Math.round(opts.taxable * 9) / 100;
    const sgst = opts.sgst ?? cgst;
    const tax = cgst + sgst;
    await getPool().query(
      `INSERT INTO purchases (id, business_id, supplier_id, bill_number, bill_date, status, place_of_supply_state_code,
          is_reverse_charge, itc_eligible, subtotal, tax_total, cgst_total, sgst_total, igst_total, grand_total,
          paid_amount, balance_amount, payment_status, branch_id, supplier_gstin, document_type, original_bill_number)
       VALUES ($1,$2,$3,$4,$5,'final','29',false,true,$6,$7,$8,$9,0,$10,0,$10,'unpaid',$11,$12,$13,$14)`,
      [
        id, B, SUPP, opts.bill, opts.date || '2026-07-15', opts.taxable, tax, cgst, sgst,
        opts.taxable + tax, BR, opts.gstin || GSTIN, opts.type || 'tax_invoice', opts.original || null,
      ]
    );
    await getPool().query(
      `INSERT INTO purchase_items (purchase_id, item_name, quantity, unit_price, taxable_value, tax_rate, tax_amount,
          cgst_amount, sgst_amount, line_total)
       VALUES ($1, 'Supplier note', 1, $2, $2, 18, $3, $4, $5, $6)`,
      [id, opts.taxable, tax, cgst, sgst, opts.taxable + tax]
    );
    return id;
  }

  async function statement(opts: {
    no: string;
    taxable: number;
    cgst?: number;
    sgst?: number;
    date?: string;
    type?: string;
    gstin?: string;
    original?: string;
  }) {
    const cgst = opts.cgst ?? Math.round(opts.taxable * 9) / 100;
    const sgst = opts.sgst ?? cgst;
    await getPool().query(
      `INSERT INTO gstr2b_invoices (import_id, business_id, filing_period, supplier_gstin, invoice_number, invoice_date,
          document_type, taxable_value, igst_amount, cgst_amount, sgst_amount, cess_amount, itc_eligibility,
          original_invoice_number)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,0,$9,$10,0,'eligible',$11)`,
      [
        importId, B, PERIOD, opts.gstin || GSTIN, opts.no, opts.date || '2026-07-15',
        opts.type || 'invoice', opts.taxable, cgst, sgst, opts.original || null,
      ]
    );
  }

  function row(matches: { invoice_number: string; document_type: string }[], number: string, type: string) {
    return matches.find((item) => item.invoice_number === number && item.document_type === type);
  }

  beforeAll(async () => {
    const pool = getPool();
    await pool.query(
      `INSERT INTO businesses (id, name, gstin, state_code, gst_registration_type)
       VALUES ($1, 'G2B supplier notes', '29AAAPA1234A1Z5', '29', 'regular')`,
      [B]
    );
    await pool.query(
      `INSERT INTO branches (id, business_id, name, state_code, is_primary, is_default, is_active)
       VALUES ($1, $2, 'Main', '29', true, true, true)`,
      [BR, B]
    );
    await pool.query(
      `INSERT INTO suppliers (id, business_id, name, state_code, gstin, current_balance)
       VALUES ($1, $2, 'Note supplier', '29', $3, 0)`,
      [SUPP, B, GSTIN]
    );
    await pool.query(
      `INSERT INTO users (id, business_id, name, phone, is_primary_admin) VALUES ($1, $2, 'Owner', $3, true)`,
      [USER, B, `9${Date.now().toString().slice(-9)}`]
    );
    importId = randomUUID();
    await pool.query(
      `INSERT INTO gstr2b_imports (id, business_id, filing_period, file_hash, total_invoices)
       VALUES ($1, $2, $3, $4, 1)`,
      [importId, B, PERIOD, randomUUID().replace(/-/g, '')]
    );
  });

  afterAll(async () => {
    const client = await getPool().connect();
    try {
      await client.query('BEGIN');
      await client.query(`SELECT set_config('khatario.ledger_delete_reason', 'tenant_purge', true)`);
      await client.query(`DELETE FROM businesses WHERE id = $1 OR name = 'G2B supplier notes'`, [B]);
      await client.query('COMMIT');
    } finally {
      client.release();
    }
    await closePool();
  });

  test('notes match their statement lines and stay apart from invoices and purchase returns', async () => {
    const engine = new GSTR2BReconciliationEngine();
    await purchase({ bill: 'G2B-CN-07', taxable: 500, cgst: 45, sgst: 45, type: 'supplier_credit_note', original: 'G2B-01' });
    await statement({ no: 'G2B-CN-07', taxable: 500, cgst: 45, sgst: 45, type: 'credit_note', original: 'G2B-01' });

    await purchase({ bill: 'G2B-DN-08', taxable: 400, cgst: 36, sgst: 36, type: 'supplier_debit_note', original: 'G2B-01' });
    await statement({ no: 'G2B-DN-08', taxable: 400, cgst: 36, sgst: 36, type: 'debit_note', original: 'G2B-01' });

    await purchase({ bill: 'G2B-CN-TAXABLE', taxable: 600, cgst: 54, sgst: 54, type: 'supplier_credit_note' });
    await statement({ no: 'G2B-CN-TAXABLE', taxable: 500, cgst: 45, sgst: 45, type: 'credit_note' });

    await purchase({ bill: 'G2B-CN-HEAD', taxable: 500, cgst: 50, sgst: 40, type: 'supplier_credit_note' });
    await statement({ no: 'G2B-CN-HEAD', taxable: 500, cgst: 45, sgst: 45, type: 'credit_note' });

    await statement({ no: 'G2B-CN-ONLY2B', taxable: 300, cgst: 27, sgst: 27, type: 'credit_note' });
    await purchase({ bill: 'G2B-DN-ONLYBOOKS', taxable: 200, cgst: 18, sgst: 18, type: 'supplier_debit_note' });

    await purchase({ bill: 'G2B-CN-GSTIN', taxable: 500, cgst: 45, sgst: 45, type: 'supplier_credit_note', gstin: OTHER });
    await statement({ no: 'G2B-CN-GSTIN', taxable: 500, cgst: 45, sgst: 45, type: 'credit_note' });

    await purchase({ bill: 'G2B-CN-DUP', taxable: 100, cgst: 9, sgst: 9, type: 'supplier_credit_note', date: '2026-07-15' });
    await statement({ no: 'G2B-CN-DUP', taxable: 100, cgst: 9, sgst: 9, type: 'credit_note', date: '2026-07-15' });
    await statement({ no: 'G2B-CN-DUP', taxable: 100, cgst: 9, sgst: 9, type: 'credit_note', date: '2026-07-16' });

    await purchase({ bill: 'G2B-CN-NEW', taxable: 250, cgst: 22.5, sgst: 22.5, type: 'supplier_credit_note' });
    await statement({ no: 'G2B-CN-NEW', taxable: 250, cgst: 22.5, sgst: 22.5, type: 'credit_note', original: 'G2B-CN-OLD' });
    await purchase({ bill: 'G2B-CN-OLD', taxable: 250, cgst: 22.5, sgst: 22.5, type: 'supplier_credit_note' });

    await purchase({ bill: 'G2B-CN-SAME', taxable: 80, cgst: 7.2, sgst: 7.2, type: 'tax_invoice' });
    await statement({ no: 'G2B-CN-SAME', taxable: 80, cgst: 7.2, sgst: 7.2, type: 'credit_note' });
    await getPool().query(
      `INSERT INTO purchase_returns (business_id, supplier_id, return_number, return_date, subtotal, cgst_total, sgst_total, grand_total, status)
       VALUES ($1, $2, 'G2B-CN-RETURN', '2026-07-15', 90, 8.1, 8.1, 106.2, 'final')`,
      [B, SUPP]
    );
    await statement({ no: 'G2B-CN-RETURN', taxable: 90, cgst: 8.1, sgst: 8.1, type: 'credit_note' });

    const first = await engine.reconcile(B, PERIOD);
    const matches = first.matches as Array<{
      invoice_number: string;
      document_type: string;
      match_status: string;
      is_credit_note?: boolean;
      difference_taxable_value: number;
      difference_cgst: number;
      difference_sgst: number;
      books_taxable_value: number;
      purchase_id?: string;
    }>;

    const cn = row(matches, 'G2B-CN-07', 'credit_note')!;
    const dn = row(matches, 'G2B-DN-08', 'debit_note')!;
    expect(cn.match_status).toBe('MATCHED');
    expect(cn.is_credit_note).toBe(true);
    expect(Number(cn.books_taxable_value)).toBe(500);
    expect(dn.match_status).toBe('MATCHED');
    expect(dn.is_credit_note).toBe(false);

    const taxable = row(matches, 'G2B-CN-TAXABLE', 'credit_note')!;
    expect(taxable.match_status).toBe('PARTIALLY_MATCHED');
    expect(Number(taxable.difference_taxable_value)).toBe(100);

    const head = row(matches, 'G2B-CN-HEAD', 'credit_note')!;
    expect(head.match_status).toBe('PARTIALLY_MATCHED');
    expect(Number(head.difference_taxable_value)).toBe(0);
    expect(Number(head.difference_cgst)).toBe(5);
    expect(Number(head.difference_sgst)).toBe(-5);

    expect(row(matches, 'G2B-CN-ONLY2B', 'credit_note')!.match_status).toBe('ONLY_IN_2B');
    expect(row(matches, 'G2B-DN-ONLYBOOKS', 'debit_note')!.match_status).toBe('MISSING_IN_2B');

    const gstinRows = matches.filter((item) => item.invoice_number === 'G2B-CN-GSTIN');
    expect(gstinRows.map((item) => item.match_status).sort()).toEqual(['MISSING_IN_2B', 'ONLY_IN_2B']);

    const dup = matches.filter((item) => item.invoice_number === 'G2B-CN-DUP');
    expect(dup.map((item) => item.match_status).sort()).toEqual(['MATCHED', 'ONLY_IN_2B']);

    expect(row(matches, 'G2B-CN-NEW', 'credit_note')!.match_status).toBe('MATCHED');
    expect(row(matches, 'G2B-CN-OLD', 'credit_note')!.match_status).toBe('MISSING_IN_2B');

    expect(row(matches, 'G2B-CN-SAME', 'tax_invoice')!.match_status).toBe('MISSING_IN_2B');
    expect(row(matches, 'G2B-CN-SAME', 'credit_note')!.match_status).toBe('ONLY_IN_2B');
    expect(row(matches, 'G2B-CN-RETURN', 'credit_note')!.match_status).toBe('ONLY_IN_2B');
    expect(matches.some((item) => item.invoice_number === 'G2B-CN-RETURN' && item.purchase_id)).toBe(false);

    const stored = await getPool().query(
      `SELECT id FROM gstr2b_reconciliation WHERE business_id = $1 AND filing_period = $2 ORDER BY id`,
      [B, PERIOD]
    );
    await engine.reconcile(B, PERIOD);
    const again = await getPool().query(
      `SELECT id FROM gstr2b_reconciliation WHERE business_id = $1 AND filing_period = $2 ORDER BY id`,
      [B, PERIOD]
    );
    expect(again.rows.map((item) => item.id)).toEqual(stored.rows.map((item) => item.id));

    const partialId = (await getPool().query(
      `SELECT id FROM gstr2b_reconciliation
        WHERE business_id = $1 AND invoice_number = 'G2B-CN-HEAD' AND document_type = 'credit_note'`,
      [B]
    )).rows[0].id;
    await engine.recordDecision(B, {
      reconciliation_id: partialId,
      decision: 'PENDING_SUPPLIER_CORRECTION',
      remarks: 'supplier note tax head',
      decided_by_user_id: USER,
    });
    await engine.reconcile(B, PERIOD);
    const decision = await getPool().query(
      `SELECT decision, remarks FROM reconciliation_decisions WHERE reconciliation_id = $1`,
      [partialId]
    );
    expect(decision.rows[0]).toMatchObject({ decision: 'PENDING_SUPPLIER_CORRECTION', remarks: 'supplier note tax head' });
  });

  test('a cancelled supplier note leaves the statement line unmatched and does not duplicate the row', async () => {
    const engine = new GSTR2BReconciliationEngine();
    const id = await purchase({ bill: 'G2B-CN-CANCEL', taxable: 150, cgst: 13.5, sgst: 13.5, type: 'supplier_credit_note' });
    await statement({ no: 'G2B-CN-CANCEL', taxable: 150, cgst: 13.5, sgst: 13.5, type: 'credit_note' });
    const matched = await engine.reconcile(B, PERIOD);
    expect(matched.matches.find((item) => item.invoice_number === 'G2B-CN-CANCEL')?.match_status).toBe('MATCHED');

    await getPool().query(`UPDATE purchases SET status = 'cancelled' WHERE id = $1`, [id]);
    const after = await engine.reconcile(B, PERIOD);
    const left = after.matches.filter((item) => item.invoice_number === 'G2B-CN-CANCEL');
    expect(left).toHaveLength(1);
    expect(left[0].match_status).toBe('ONLY_IN_2B');
    expect(left[0].purchase_id == null).toBe(true);
  });

  test('a credit note reduces input GST and a debit note increases it, once each', async () => {
    await getPool().query(`SELECT create_default_chart_of_accounts($1)`, [B]);
    await getPool().query(`SELECT ensure_phase3_gst_accounts($1)`, [B]);

    const creditId = await purchase({ bill: 'G2B-CN-LEDGER', taxable: 500, cgst: 45, sgst: 45, type: 'supplier_credit_note' });
    const debitId = await purchase({ bill: 'G2B-DN-LEDGER', taxable: 400, cgst: 36, sgst: 36, type: 'supplier_debit_note' });
    const client = await getPool().connect();
    try {
      await client.query('BEGIN');
      await createPurchaseReturnLedgerEntries({
        businessId: B,
        purchaseReturnId: creditId,
        returnNumber: 'G2B-CN-LEDGER',
        returnDate: '2026-07-15',
        grandTotal: 590,
        supplierId: SUPP,
        inventoryAmount: 0,
        branchId: BR,
        poolClient: client,
        taxableValue: 500,
        cgstTotal: 45,
        sgstTotal: 45,
        itcEligible: true,
        voucherType: 'supplier_credit_note',
      });
      await createPurchaseLedgerEntries({
        businessId: B,
        purchaseId: debitId,
        purchaseNumber: 'G2B-DN-LEDGER',
        purchaseDate: '2026-07-15',
        grandTotal: 472,
        supplierId: SUPP,
        isCashPurchase: false,
        inventoryAmount: 0,
        branchId: BR,
        poolClient: client,
        taxableValue: 400,
        cgstTotal: 36,
        sgstTotal: 36,
        itcEligible: true,
      });
      const lines = await client.query(
        `SELECT l.voucher_id, l.voucher_type, a.account_code, l.debit, l.credit
           FROM ledger_entry_lines l
           JOIN accounts a ON a.id = l.account_id
          WHERE l.business_id = $1 AND l.voucher_id = ANY($2::uuid[])`,
        [B, [creditId, debitId]]
      );
      const creditCgst = lines.rows.find((line) => line.voucher_id === creditId && line.account_code === '1110');
      const debitCgst = lines.rows.find((line) => line.voucher_id === debitId && line.account_code === '1110');
      expect(creditCgst.voucher_type).toBe('supplier_credit_note');
      expect(Number(creditCgst.credit)).toBe(45);
      expect(Number(creditCgst.debit)).toBe(0);
      expect(debitCgst.voucher_type).toBe('purchase');
      expect(Number(debitCgst.debit)).toBe(36);
      expect(lines.rows.some((line) => line.voucher_id === creditId && line.voucher_type === 'purchase')).toBe(false);
      const returns = await client.query(`SELECT COUNT(*)::int AS n FROM purchase_returns WHERE business_id = $1 AND return_number = 'G2B-CN-LEDGER'`, [B]);
      expect(returns.rows[0].n).toBe(0);
      const copies = await client.query(`SELECT COUNT(*)::int AS n FROM purchases WHERE business_id = $1 AND bill_number = 'G2B-CN-LEDGER'`, [B]);
      expect(copies.rows[0].n).toBe(1);
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
  });
});
