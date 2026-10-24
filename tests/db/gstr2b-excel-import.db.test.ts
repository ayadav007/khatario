/**
 * Excel and JSON GSTR-2B imports share one persistence path.
 * Runs only when PHASE2_TEST_DATABASE_URL points at kh_phase2_test.
 */
import { randomUUID } from 'crypto';
import ExcelJS from 'exceljs';

const url = process.env.PHASE2_TEST_DATABASE_URL;
if (url) process.env.DATABASE_URL = url;
const d = url ? describe : describe.skip;

import { getPool, closePool } from '@/lib/db';
import { Gstr2bImportError, importGstr2bFile, persistGstr2bRows } from '@/lib/gst/gstr2b-import';
import { GSTR2BReconciliationEngine } from '@/lib/gst/gstr2b-reconciliation';
import type { Gstr2bRow } from '@/lib/gst/gstr2b-portal-parser';

const OWN = '29AAAPA1234A1Z5';
const SUPPLIER = '29G2BTS1001A1ZJ';

async function excelBytes(): Promise<Buffer> {
  const book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet('B2B');
  sheet.getCell('A1').value = 'SYNTHETIC GSTR-2B fixture — not a GST portal download';
  sheet.getCell('A2').value = 'GSTIN';
  sheet.getCell('B2').value = OWN;
  sheet.getCell('A3').value = 'Return period';
  sheet.getCell('B3').value = '062026';
  sheet.addRow(['GSTIN of supplier', 'Invoice number', 'Invoice Date', 'Taxable Value', 'Integrated Tax', 'Central Tax', 'State/UT Tax', 'Cess', 'ITC Availability', 'Supply Attract Reverse Charge']);
  sheet.addRow([SUPPLIER, 'EXL-01', '15-06-2026', 1000, 0, 90, 90, 0, 'Yes', 'No']);
  sheet.addRow([SUPPLIER, 'EXL-PART', '15-06-2026', 900, 0, 81, 81, 0, 'Yes', 'No']);
  const notes = book.addWorksheet('B2B-CDNR');
  notes.getCell('A2').value = 'GSTIN';
  notes.getCell('B2').value = OWN;
  notes.getCell('A3').value = 'Return period';
  notes.getCell('B3').value = '062026';
  notes.addRow(['GSTIN of supplier', 'Note number', 'Note type', 'Note date', 'Taxable Value', 'Integrated Tax', 'Central Tax', 'State/UT Tax', 'Cess', 'ITC Availability']);
  notes.addRow([SUPPLIER, 'EXL-CN', 'Credit', '15-06-2026', 500, 0, 45, 45, 0, 'Yes']);
  const out = await book.xlsx.writeBuffer();
  return Buffer.from(out);
}

d('GSTR-2B Excel and JSON import persistence (real DB)', () => {
  jest.setTimeout(90000);
  const B = randomUUID();
  const BR = randomUUID();
  const SUPP = randomUUID();

  beforeAll(async () => {
    const pool = getPool();
    await pool.query(
      `INSERT INTO businesses (id, name, gstin, state_code, gst_registration_type)
       VALUES ($1, 'G2B excel import', $2, '29', 'regular')`,
      [B, OWN]
    );
    await pool.query(
      `INSERT INTO branches (id, business_id, name, state_code, is_primary, is_default, is_active)
       VALUES ($1, $2, 'Main', '29', true, true, true)`,
      [BR, B]
    );
    await pool.query(
      `INSERT INTO suppliers (id, business_id, name, state_code, gstin, current_balance)
       VALUES ($1, $2, 'Excel supplier', '29', $3, 0)`,
      [SUPP, B, SUPPLIER]
    );
  });

  afterAll(async () => {
    const client = await getPool().connect();
    try {
      await client.query('BEGIN');
      await client.query(`SELECT set_config('khatario.ledger_delete_reason', 'tenant_purge', true)`);
      await client.query(`DELETE FROM businesses WHERE id = $1 OR name = 'G2B excel import'`, [B]);
      await client.query('COMMIT');
    } finally {
      client.release();
    }
    await closePool();
  });

  test('excel import persists documents, rejects a repeat and a wrong period, and reconciles', async () => {
    const bytes = await excelBytes();
    const saved = await importGstr2bFile({
      businessId: B,
      userId: null,
      filingPeriod: '2026-06',
      fileName: 'synthetic-gstr2b.xlsx',
      bytes,
    });
    expect(saved.source).toBe('excel');
    expect(saved.invoices_imported).toBe(3);
    const stored = await getPool().query(
      `SELECT invoice_number, document_type, taxable_value, cgst_amount, itc_eligibility, reverse_charge
         FROM gstr2b_invoices WHERE business_id = $1 AND filing_period = '2026-06' ORDER BY invoice_number`,
      [B]
    );
    expect(stored.rows).toEqual([
      expect.objectContaining({ invoice_number: 'EXL-01', document_type: 'invoice', taxable_value: '1000.00', cgst_amount: '90.00' }),
      expect.objectContaining({ invoice_number: 'EXL-CN', document_type: 'credit_note', taxable_value: '500.00', cgst_amount: '45.00' }),
      expect.objectContaining({ invoice_number: 'EXL-PART', document_type: 'invoice', taxable_value: '900.00' }),
    ]);

    await expect(importGstr2bFile({
      businessId: B, userId: null, filingPeriod: '2026-06', fileName: 'synthetic-gstr2b.xlsx', bytes,
    })).rejects.toMatchObject({ code: 'DUPLICATE_IMPORT', status: 409 });
    const imports = await getPool().query(`SELECT COUNT(*)::int AS n FROM gstr2b_imports WHERE business_id = $1`, [B]);
    expect(imports.rows[0].n).toBe(1);

    await expect(importGstr2bFile({
      businessId: B, userId: null, filingPeriod: '2026-07', fileName: 'synthetic-gstr2b.xlsx', bytes,
    })).rejects.toMatchObject({ code: 'PERIOD_MISMATCH' });

    const other = Buffer.from(JSON.stringify({
      data: { gstin: '27AAAAA0000A1Z5', rtnprd: '062026', docdata: { b2b: [{ ctin: SUPPLIER, inv: [{ inum: 'OTHER', dt: '15-06-2026', txval: 1, igst: 0, cgst: 0, sgst: 0, cess: 0 }] }] } },
    }));
    await expect(importGstr2bFile({
      businessId: B, userId: null, filingPeriod: '2026-06', fileName: 'other.json', bytes: other,
    })).rejects.toMatchObject({ code: 'GSTIN_MISMATCH' });

    const purchaseId = randomUUID();
    await getPool().query(
      `INSERT INTO purchases (id, business_id, supplier_id, bill_number, bill_date, status, place_of_supply_state_code,
          is_reverse_charge, itc_eligible, subtotal, tax_total, cgst_total, sgst_total, igst_total, grand_total,
          paid_amount, balance_amount, payment_status, branch_id, supplier_gstin, document_type)
       VALUES ($1,$2,$3,'EXL-01','2026-06-15','final','29',false,true,1000,180,90,90,0,1180,0,1180,'unpaid',$4,$5,'tax_invoice')`,
      [purchaseId, B, SUPP, BR, SUPPLIER]
    );
    await getPool().query(
      `INSERT INTO purchase_items (purchase_id, item_name, quantity, unit_price, taxable_value, tax_rate, tax_amount, cgst_amount, sgst_amount, line_total)
       VALUES ($1, 'Service', 1, 1000, 1000, 18, 180, 90, 90, 1180)`,
      [purchaseId]
    );
    const blankId = randomUUID();
    await getPool().query(
      `INSERT INTO purchases (id, business_id, supplier_id, bill_number, bill_date, status, place_of_supply_state_code,
          is_reverse_charge, itc_eligible, subtotal, tax_total, cgst_total, sgst_total, igst_total, grand_total,
          paid_amount, balance_amount, payment_status, branch_id, supplier_gstin, document_type)
       VALUES ($1,$2,$3,'   ','2026-06-15','final','29',false,true,10,0,0,0,0,10,0,10,'unpaid',$4,$5,'tax_invoice')`,
      [blankId, B, SUPP, BR, SUPPLIER]
    );
    await getPool().query(
      `INSERT INTO purchase_items (purchase_id, item_name, quantity, unit_price, taxable_value, tax_rate, tax_amount, cgst_amount, sgst_amount, line_total)
       VALUES ($1, 'Blank', 1, 10, 10, 0, 0, 0, 0, 10)`,
      [blankId]
    );

    const engine = new GSTR2BReconciliationEngine();
    const first = await engine.reconcile(B, '2026-06');
    const exact = first.matches.find((row) => row.invoice_number === 'EXL-01');
    const partial = first.matches.find((row) => row.invoice_number === 'EXL-PART');
    const note = first.matches.find((row) => row.invoice_number === 'EXL-CN');
    expect(exact?.match_status).toBe('MATCHED');
    expect(partial?.match_status).toBe('ONLY_IN_2B');
    expect(note?.match_status).toBe('ONLY_IN_2B');
    expect(note?.is_credit_note).toBe(true);
    expect(first.missing_references.some((row) => row.purchase_id === blankId)).toBe(true);
    const ids = (await getPool().query(`SELECT id FROM gstr2b_reconciliation WHERE business_id = $1 AND filing_period = '2026-06' ORDER BY id`, [B])).rows.map((row) => row.id);
    await engine.reconcile(B, '2026-06');
    const again = (await getPool().query(`SELECT id FROM gstr2b_reconciliation WHERE business_id = $1 AND filing_period = '2026-06' ORDER BY id`, [B])).rows.map((row) => row.id);
    expect(again).toEqual(ids);
    const invoiceCount = await getPool().query(`SELECT COUNT(*)::int AS n FROM gstr2b_invoices WHERE business_id = $1 AND filing_period = '2026-06'`, [B]);
    expect(invoiceCount.rows[0].n).toBe(3);
  });

  test('a json file still imports, and a failed insert rolls the statement back', async () => {
    const json = Buffer.from(JSON.stringify({
      data: {
        gstin: OWN,
        rtnprd: '052026',
        docdata: { b2b: [{ ctin: SUPPLIER, trdnm: 'Supplier', inv: [{ inum: 'JSON-01', dt: '15-05-2026', txval: 100, igst: 0, cgst: 9, sgst: 9, cess: 0, itcavl: 'Y', rev: 'N' }] }] },
      },
    }));
    const saved = await importGstr2bFile({
      businessId: B, userId: null, filingPeriod: '2026-05', fileName: 'statement.json', bytes: json,
    });
    expect(saved.source).toBe('json');
    expect(saved.invoices_imported).toBe(1);

    const bad: Gstr2bRow = {
      supplier_gstin: SUPPLIER,
      supplier_name: null,
      invoice_number: 'OK',
      invoice_date: '2026-04-15',
      document_type: 'invoice',
      taxable_value: 1, igst_amount: 0, cgst_amount: 0, sgst_amount: 0, cess_amount: 0,
      itc_eligibility: 'eligible', itc_reversal_type: null, place_of_supply: '29', reverse_charge: 'N',
      original_invoice_number: null, original_invoice_date: null,
    };
    const worse = { ...bad, invoice_number: 'BAD', invoice_date: '2026-13-40' };
    await expect(persistGstr2bRows({
      businessId: B, userId: null, filingPeriod: '2026-04', fileName: 'bad.json', fileHash: randomUUID().replace(/-/g, ''),
      importType: 'json', rows: [bad, worse],
    })).rejects.toBeTruthy();
    const left = await getPool().query(
      `SELECT COUNT(*)::int AS n FROM gstr2b_imports WHERE business_id = $1 AND filing_period = '2026-04'`,
      [B]
    );
    expect(left.rows[0].n).toBe(0);
    expect(Gstr2bImportError).toBeDefined();
  });
});
