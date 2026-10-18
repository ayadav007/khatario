import fs from 'fs';
import path from 'path';
import ExcelJS from 'exceljs';
import {
  b2clThresholdLabel,
  generateOfficialGSTR1Excel,
  gstFinancialYear,
} from '@/lib/export/gstr1-official-excel';
import { generateGstr1OfflineToolV22Excel } from '@/lib/export/gstr1-offline-tool-v22-excel';

const hsn = (over: Record<string, unknown>) => ({
  hsn_sac: '998314',
  description: 'Service',
  uqc: 'NA',
  total_quantity: 1,
  total_value: 118,
  taxable_value: 100,
  integrated_tax: 18,
  central_tax: 0,
  state_ut_tax: 0,
  cess_amount: 0,
  rate: 18,
  ...over,
});

function report() {
  return {
    summary: {
      total_outward_taxable_supplies: 0,
      total_tax_amount: 0,
      invoice_count: 0,
      b2b_count: 0,
      b2cl_count: 0,
      b2cs_count: 0,
    },
    b2b: [],
    b2cl: [
      {
        invoice_number: 'INV-066',
        invoice_date: '2026-10-18',
        invoice_value: 118000,
        place_of_supply: '27',
        rate: 18,
        taxable_value: 100000,
        igst_amount: 18000,
        cess_amount: 0,
        ecommerce_gstin: null,
      },
    ],
    b2cs: [],
    hsn: [hsn({ taxable_value: 4000, total_quantity: 3 }), hsn({ taxable_value: -1500, total_quantity: -2, integrated_tax: -270, total_value: -1770 })],
    hsn_b2b: [hsn({ uqc: 'PCS', taxable_value: 4000, total_quantity: 3, integrated_tax: 360, central_tax: 180, state_ut_tax: 180 })],
    hsn_b2c: [
      hsn({ uqc: 'PCS', taxable_value: 207000, total_quantity: 203, integrated_tax: 18900 }),
      hsn({ taxable_value: -1500, total_quantity: -2, integrated_tax: -270, total_value: -1770 }),
    ],
    nil: [],
    exports: [
      {
        export_type: 'WPAY',
        invoice_number: 'INV-063',
        invoice_date: '2026-10-18',
        invoice_value: 2950,
        port_code: null,
        shipping_bill_number: null,
        shipping_bill_date: null,
        rate: 18,
        taxable_value: 2500,
        igst_amount: 450,
      },
    ],
    sez: [],
    cdn: [
      {
        gstin_uin_recipient: null,
        receiver_name: null,
        note_number: 'CN-401702',
        note_date: '2026-10-18',
        note_type: 'C' as const,
        place_of_supply: '27',
        invoice_value: 1180,
        original_invoice_number: 'INV-066',
        original_invoice_date: '2026-10-18',
        note_supply_type: 'Regular',
        cdnur_typ: 'B2CL' as const,
        tax_rate: 18,
        taxable_value: 1000,
        igst_amount: 180,
        cgst_amount: 0,
        sgst_amount: 0,
        cess_amount: 0,
      },
      {
        gstin_uin_recipient: null,
        receiver_name: null,
        note_number: 'CN-401703',
        note_date: '2026-10-18',
        note_type: 'C' as const,
        place_of_supply: '96',
        invoice_value: 590,
        original_invoice_number: 'INV-068',
        original_invoice_date: '2026-10-18',
        note_supply_type: 'Regular',
        cdnur_typ: 'EXPWP' as const,
        tax_rate: 18,
        taxable_value: 500,
        igst_amount: 90,
        cgst_amount: 0,
        sgst_amount: 0,
        cess_amount: 0,
      },
    ],
    at: [{ place_of_supply: '29', rate: 18, taxable_value: 3000, igst: 0, cgst: 270, sgst: 270, cess: 0 }],
    atadj: [{ place_of_supply: '29', rate: 18, taxable_value: 1000, igst: 0, cgst: 90, sgst: 90, cess: 0 }],
    doc_issues: [
      { doc_num: 1, nature: 'Invoices for outward supply', from: 'INV-041', to: 'INV-071', totnum: 31, cancel: 0, net_issue: 31 },
      { doc_num: 1, nature: 'Invoices for outward supply', from: 'BOS-002', to: 'BOS-004', totnum: 3, cancel: 0, net_issue: 3 },
      { doc_num: 5, nature: 'Credit Note', from: 'CN-401702', to: 'CN-401704', totnum: 3, cancel: 0, net_issue: 3 },
    ],
  };
}

const filters = { month: 10, year: 2026, business_id: '00000000-0000-0000-0000-000000000001' };

function cell(sheet: ExcelJS.Worksheet, row: number, col: number) {
  const value = sheet.getRow(row).getCell(col).value;
  return value === null || value === undefined ? '' : value;
}

async function load(buf: Buffer) {
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(buf);
  return book;
}

describe('GSTR-1 workbook defects', () => {
  it('labels the B2CL threshold and financial year from the return period', () => {
    expect(b2clThresholdLabel(10, 2026)).toContain('1,00,000');
    expect(b2clThresholdLabel(1, 2024)).toContain('2,50,000');
    expect(gstFinancialYear(10, 2026)).toBe('2026-27');
    expect(gstFinancialYear(1, 2026)).toBe('2025-26');
  });

  it('keeps B2B and B2C HSN apart, including a negative B2C row', async () => {
    const data = report();
    const book = await load(await generateOfficialGSTR1Excel(data as any, filters as any, '29', '29AAAAA0000A1Z5'));
    const b2b = book.getWorksheet('HSN(B2B)')!;
    const b2c = book.getWorksheet('HSN(B2C)')!;
    expect(book.getWorksheet('HSN')).toBeUndefined();
    expect(cell(b2b, 2, 1)).toBe('998314');
    expect(cell(b2b, 2, 6)).toBe(4000);
    expect(cell(b2c, 3, 4)).toBe(-2);
    expect(cell(b2c, 3, 6)).toBe(-1500);
    expect(cell(b2c, 3, 7)).toBe(-270);
    expect(b2b.rowCount).toBe(2);

    const again = await load(await generateOfficialGSTR1Excel(data as any, filters as any, '29', '29AAAAA0000A1Z5'));
    expect(again.getWorksheet('HSN(B2C)')!.rowCount).toBe(b2c.rowCount);
  });

  it('writes the B2CL rate in the Rate column and export IGST on the summary', async () => {
    const book = await load(await generateOfficialGSTR1Excel(report() as any, filters as any, '29', '29AAAAA0000A1Z5'));
    const b2cl = book.getWorksheet('B2CL')!;
    expect(cell(b2cl, 1, 5)).toBe('Applicable % of Tax Rate');
    expect(cell(b2cl, 1, 6)).toBe('Rate');
    expect(cell(b2cl, 2, 5)).toBe('');
    expect(cell(b2cl, 2, 6)).toBe(18);
    expect(cell(b2cl, 2, 7)).toBe(100000);
    expect(cell(b2cl, 2, 8)).toBe(18000);

    const exp = book.getWorksheet('EXP')!;
    expect(cell(exp, 1, 8)).toBe('Applicable % of Tax Rate');
    expect(cell(exp, 1, 9)).toBe('Rate');
    expect(cell(exp, 1, 11)).toBe('Integrated Tax');
    expect(cell(exp, 2, 8)).toBe('');
    expect(cell(exp, 2, 9)).toBe(18);
    expect(cell(exp, 2, 11)).toBe(450);

    const summary = book.getWorksheet('Summary')!;
    const rows = summary.rowCount;
    let exportIgst = 0;
    let grand = 0;
    let b2clLabel = '';
    for (let r = 2; r <= rows; r++) {
      if (cell(summary, r, 1) === 'EXPORT') exportIgst = Number(cell(summary, r, 4));
      if (cell(summary, r, 1) === 'GRAND TOTAL') grand = Number(cell(summary, r, 3));
      if (cell(summary, r, 1) === 'B2CL') b2clLabel = String(cell(summary, r, 2));
    }
    expect(exportIgst).toBe(450);
    expect(grand).toBe(100000 + 2500 + 1500);
    expect(b2clLabel).toContain('1,00,000');

    const master = book.getWorksheet('Master')!;
    expect(cell(master, 3, 2)).toBe('2026-27');
    expect(cell(master, 4, 2)).toBe('2610');
  });

  it('writes the CDNUR GST rate under Rate for B2CL and EXPWP notes', async () => {
    const book = await load(await generateOfficialGSTR1Excel(report() as any, filters as any, '29', '29AAAAA0000A1Z5'));
    const sheet = book.getWorksheet('CDNUR')!;
    const headers = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((c) => cell(sheet, 1, c));
    expect(headers).not.toContain('Applicable % of Tax Rate');
    expect(cell(sheet, 1, 8)).toBe('Rate');
    expect(cell(sheet, 2, 1)).toBe('B2CL');
    expect(cell(sheet, 2, 2)).toBe('CN-401702');
    expect(cell(sheet, 2, 8)).toBe(18);
    expect(cell(sheet, 2, 9)).toBe(1000);
    expect(cell(sheet, 2, 10)).toBe(180);
    expect(cell(sheet, 3, 1)).toBe('EXPWP');
    expect(cell(sheet, 3, 2)).toBe('CN-401703');
    expect(cell(sheet, 3, 8)).toBe(18);
    expect(cell(sheet, 3, 9)).toBe(500);
    expect(cell(sheet, 3, 10)).toBe(90);
  });

  it('fills advance and document sheets from the report, without collapsing series', async () => {
    const book = await load(await generateOfficialGSTR1Excel(report() as any, filters as any, '29', '29AAAAA0000A1Z5'));
    const at = book.getWorksheet('AT')!;
    const txp = book.getWorksheet('TXP')!;
    expect(cell(at, 1, 1)).toBe('Place Of Supply');
    expect(cell(at, 2, 3)).toBe(3000);
    expect(cell(at, 2, 5)).toBe(270);
    expect(cell(txp, 2, 3)).toBe(1000);
    expect(cell(txp, 2, 6)).toBe(90);

    const docs = book.getWorksheet('Docs')!;
    expect(cell(docs, 2, 2)).toBe('INV-041');
    expect(cell(docs, 3, 2)).toBe('BOS-002');
    expect(cell(docs, 4, 1)).toBe('Credit Note');
    expect(cell(docs, 2, 4)).not.toBe(52);
  });

  it('writes the offline tool sheets without merging HSN or document series', async () => {
    const data = report();
    const buf = await generateGstr1OfflineToolV22Excel(data as any, filters as any, '29', '29AAAAA0000A1Z5');
    const book = await load(buf);
    const b2b = book.getWorksheet('hsn(b2b)')!;
    const b2c = book.getWorksheet('hsn(b2c)')!;
    expect(cell(b2b, 5, 7)).toBe(4000);
    expect(cell(b2c, 6, 4)).toBe(-2);
    expect(cell(b2c, 6, 7)).toBe(-1500);
    expect(cell(b2b, 6, 1)).toBe('');

    const at = book.getWorksheet('at')!;
    const atadj = book.getWorksheet('atadj')!;
    expect(cell(at, 5, 4)).toBe(3000);
    expect(cell(at, 5, 3)).toBe(18);
    expect(cell(atadj, 5, 4)).toBe(1000);

    const docs = book.getWorksheet('docs')!;
    expect(cell(docs, 5, 2)).toBe('INV-041');
    expect(cell(docs, 6, 2)).toBe('BOS-002');
    expect(String(cell(docs, 5, 2))).not.toBe('BOS-002');
    expect(cell(docs, 7, 1)).toBe('Credit Note');

    const out = path.join(process.cwd(), 'gstr1-verification', 'G1TEST-20261018', 'after-fix');
    fs.mkdirSync(out, { recursive: true });
    fs.writeFileSync(path.join(out, 'offline-v22.xlsx'), buf);
    fs.writeFileSync(
      path.join(out, 'khatario-excel.xlsx'),
      await generateOfficialGSTR1Excel(data as any, filters as any, '29', '29AAAAA0000A1Z5')
    );
  });
});
