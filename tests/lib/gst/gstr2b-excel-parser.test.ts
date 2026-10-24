import ExcelJS from 'exceljs';
import { parseGstr2bExcel } from '@/lib/gst/gstr2b-excel-parser';
import { parseGstr2bJson } from '@/lib/gst/gstr2b-portal-parser';

const GSTIN = '29AABCT1332L1ZL';
const SUPPLIER = '29G2BTS1001A1ZJ';

async function workbook(build: (book: ExcelJS.Workbook) => void): Promise<Buffer> {
  const book = new ExcelJS.Workbook();
  build(book);
  const out = await book.xlsx.writeBuffer();
  return Buffer.from(out);
}

function meta(sheet: ExcelJS.Worksheet, period = '112026') {
  sheet.getCell('A1').value = 'SYNTHETIC GSTR-2B fixture — not a GST portal download';
  sheet.getCell('A2').value = 'GSTIN';
  sheet.getCell('B2').value = GSTIN;
  sheet.getCell('A3').value = 'Return period';
  sheet.getCell('B3').value = period;
}

describe('GSTR-2B Excel parser (synthetic portal-style workbook)', () => {
  it('reads several detail sheets, ITC flags, notes, amendments, reverse charge, ISD and imports', async () => {
    const bytes = await workbook((book) => {
      const readme = book.addWorksheet('Read Me');
      meta(readme);
      readme.getCell('A5').value = 'Instructions only';

      const summary = book.addWorksheet('ITC Available Summary');
      summary.getCell('A1').value = 'Table 3 totals';

      const unavailable = book.addWorksheet('ITC Unavailable Summary');
      unavailable.getCell('A1').value = 'Table 4 totals';

      const b2b = book.addWorksheet('B2B');
      meta(b2b);
      b2b.addRow([]);
      b2b.addRow(['GSTIN of supplier', 'Trade/Legal name', 'Invoice Details', '', '', '', 'Place of supply', 'Supply Attract Reverse Charge', 'Taxable Value', 'Tax Amount', '', '', '', 'ITC Availability', 'Reason']);
      b2b.addRow(['', '', 'Invoice number', 'Invoice type', 'Invoice Date', 'Invoice Value', '', '', '', 'Integrated Tax', 'Central Tax', 'State/UT Tax', 'Cess', '', '']);
      b2b.addRow([SUPPLIER, 'Supplier', 'EXL-01', 'Regular', '15-11-2026', 1180, '29-Karnataka', 'No', 1000, 0, 90, 90, 0, 'Yes', '']);
      b2b.addRow([SUPPLIER, 'Supplier', 'EXL-RCM', 'Regular', '16-11-2026', 118, '29', 'Yes', 100, 0, 9, 9, 0, 'Yes', '']);
      b2b.addRow([SUPPLIER, 'Supplier', 'EXL-NOITC', 'Regular', '16-11-2026', 236, '29', 'No', 200, 0, 18, 18, 0, 'No', 'POS']);
      b2b.addRow([SUPPLIER, 'Supplier', 'EXL-NEG', 'Regular', '17-11-2026', -118, '29', 'No', -100, 0, -9, -9, 0, 'Yes', '']);
      b2b.addRow([SUPPLIER, 'Supplier', 'EXL-ZERO', 'Regular', '17-11-2026', 50, '29', 'No', 50, 0, 0, 0, '', 'Yes', '']);
      b2b.addRow([SUPPLIER, 'Supplier', 'EXL-SPLIT', 'Regular', '18-11-2026', 590, '29', 'No', 300, 0, 27, 27, 0, 'Yes', '']);
      b2b.addRow([SUPPLIER, 'Supplier', 'EXL-SPLIT', 'Regular', '18-11-2026', 236, '29', 'No', 200, 0, 18, 18, 0, 'Yes', '']);
      b2b.addRow([SUPPLIER, 'Supplier', 'EXL-DUP', 'Regular', '18-11-2026', 118, '29', 'No', 100, 0, 9, 9, 0, 'Yes', '']);
      b2b.addRow([SUPPLIER, 'Supplier', 'EXL-DUP', 'Regular', '18-11-2026', 118, '29', 'No', 100, 0, 9, 9, 0, 'Yes', '']);
      const zeroInvoice = b2b.addRow([SUPPLIER, 'Supplier', '000123', 'Regular', '18-11-2026', 118, '29', 'No', 100, 0, 9, 9, 0, 'Yes', '']);
      zeroInvoice.getCell(3).value = '000123';

      const b2ba = book.addWorksheet('B2BA');
      meta(b2ba);
      b2ba.addRow(['GSTIN of supplier', 'Trade/Legal name', 'Invoice number', 'Invoice Date', 'Original Invoice number', 'Original Invoice Date', 'Taxable Value', 'Integrated Tax', 'Central Tax', 'State/UT Tax', 'Cess', 'ITC Availability', 'Supply Attract Reverse Charge']);
      b2ba.addRow([SUPPLIER, 'Supplier', 'EXL-14R', '15-11-2026', 'EXL-14O', '01-10-2026', 700, 0, 63, 63, 0, 'Yes', 'No']);

      const cdnr = book.addWorksheet('B2B-CDNR');
      meta(cdnr);
      cdnr.addRow(['GSTIN of supplier', 'Trade/Legal name', 'Note number', 'Note type', 'Note date', 'Invoice number', 'Taxable Value', 'Integrated Tax', 'Central Tax', 'State/UT Tax', 'Cess', 'ITC Availability', 'Supply Attract Reverse Charge']);
      cdnr.addRow([SUPPLIER, 'Supplier', 'EXL-CN', 'Credit', '15-11-2026', 'EXL-01', 500, 0, 45, 45, 0, 'Yes', 'No']);
      cdnr.addRow([SUPPLIER, 'Supplier', 'EXL-DN', 'Debit', '15-11-2026', 'EXL-01', 400, 0, 36, 36, 0, 'Yes', 'No']);

      const cdnra = book.addWorksheet('B2B-CDNRA');
      meta(cdnra);
      cdnra.addRow(['GSTIN of supplier', 'Trade/Legal name', 'Note number', 'Note type', 'Note date', 'Original Note number', 'Original Note date', 'Taxable Value', 'Integrated Tax', 'Central Tax', 'State/UT Tax', 'Cess', 'ITC Availability']);
      cdnra.addRow([SUPPLIER, 'Supplier', 'EXL-CNR', 'Credit', '20-11-2026', 'EXL-CNO', '01-11-2026', 50, 0, 4.5, 4.5, 0, 'Yes']);

      const isd = book.addWorksheet('ISD');
      meta(isd);
      isd.addRow(['GSTIN of supplier', 'Trade/Legal name', 'ISD Document number', 'ISD Document date', 'Integrated Tax', 'Central Tax', 'State/UT Tax', 'Cess', 'ITC Availability']);
      isd.addRow([SUPPLIER, 'ISD', 'EXL-ISD', '15-11-2026', 0, 18, 18, 0, 'Yes']);

      const isda = book.addWorksheet('ISDA');
      meta(isda);
      isda.addRow(['GSTIN of supplier', 'Trade/Legal name', 'ISD Document number', 'ISD Document date', 'Original Document number', 'Original Document date', 'Central Tax', 'State/UT Tax', 'ITC Availability']);
      isda.addRow([SUPPLIER, 'ISD', 'EXL-ISDR', '21-11-2026', 'EXL-ISDO', '01-10-2026', 9, 9, 'Yes']);

      const impg = book.addWorksheet('IMPG');
      meta(impg);
      impg.addRow(['Port code', 'Bill of Entry number', 'Bill of Entry date', 'Taxable Value', 'Integrated Tax', 'Cess']);
      impg.addRow(['INMAA', 'EXLBOE', '15-11-2026', 8000, 1440, 0]);

      const impga = book.addWorksheet('IMPGA');
      meta(impga);
      impga.addRow(['Port code', 'Bill of Entry number', 'Bill of Entry date', 'Original Bill of Entry number', 'Taxable Value', 'Integrated Tax', 'Cess']);
      impga.addRow(['INMAA', 'EXLBOER', '22-11-2026', 'EXLBOEO', 1000, 180, 0]);

      const sez = book.addWorksheet('IMPGSEZ');
      meta(sez);
      sez.addRow(['GSTIN of supplier', 'Trade/Legal name', 'Port code', 'Bill of Entry number', 'Bill of Entry date', 'Taxable Value', 'Integrated Tax', 'Cess']);
      sez.addRow([SUPPLIER, 'SEZ', 'INSEZ', 'EXLSEZ', '15-11-2026', 2000, 360, 0]);

      const eco = book.addWorksheet('ECO');
      eco.getCell('A1').value = 'E-commerce documents';
    });

    const parsed = await parseGstr2bExcel(bytes);
    expect(parsed.ok).toBe(true);
    expect(parsed.errors).toEqual([]);
    expect(parsed.returnPeriod).toBe('2026-11');
    expect(parsed.recipientGstin).toBe(GSTIN);
    expect(parsed.duplicatesSkipped).toBe(1);
    expect(parsed.sections.find((section) => section.sheet === 'Read Me')?.status).toBe('skipped');
    expect(parsed.sections.find((section) => section.sheet === 'ITC Available Summary')?.status).toBe('skipped');
    expect(parsed.sections.find((section) => section.sheet === 'ITC Unavailable Summary')?.status).toBe('skipped');
    expect(parsed.sections.find((section) => section.sheet === 'ECO')?.status).toBe('skipped');
    expect(parsed.sections.filter((section) => section.status === 'imported').map((section) => section.sheet)).toEqual([
      'B2B', 'B2BA', 'B2B-CDNR', 'B2B-CDNRA', 'ISD', 'ISDA', 'IMPG', 'IMPGA', 'IMPGSEZ',
    ]);

    const byNumber = (number: string) => parsed.rows.find((row) => row.invoice_number === number)!;
    expect(byNumber('EXL-01')).toMatchObject({ document_type: 'invoice', taxable_value: 1000, cgst_amount: 90, sgst_amount: 90, itc_eligibility: 'eligible', reverse_charge: 'N', invoice_date: '2026-11-15' });
    expect(byNumber('EXL-RCM').reverse_charge).toBe('Y');
    expect(byNumber('EXL-NOITC').itc_eligibility).toBe('ineligible');
    expect(byNumber('EXL-NEG')).toMatchObject({ taxable_value: -100, cgst_amount: -9, sgst_amount: -9 });
    expect(byNumber('EXL-ZERO')).toMatchObject({ taxable_value: 50, cgst_amount: 0, igst_amount: 0 });
    expect(byNumber('EXL-SPLIT')).toMatchObject({ taxable_value: 500, cgst_amount: 45, sgst_amount: 45 });
    expect(byNumber('000123').invoice_number).toBe('000123');
    expect(byNumber('EXL-14R')).toMatchObject({ original_invoice_number: 'EXL-14O', original_invoice_date: '2026-10-01' });
    expect(byNumber('EXL-CN')).toMatchObject({ document_type: 'credit_note', original_invoice_number: 'EXL-01', taxable_value: 500, cgst_amount: 45 });
    expect(byNumber('EXL-DN')).toMatchObject({ document_type: 'debit_note', taxable_value: 400, cgst_amount: 36 });
    expect(byNumber('EXL-CNR')).toMatchObject({ document_type: 'credit_note', original_invoice_number: 'EXL-CNO' });
    expect(byNumber('EXL-ISD')).toMatchObject({ document_type: 'isd', taxable_value: 0, cgst_amount: 18, sgst_amount: 18 });
    expect(byNumber('EXL-ISDR')).toMatchObject({ document_type: 'isd', original_invoice_number: 'EXL-ISDO' });
    expect(byNumber('INMAA/EXLBOE')).toMatchObject({ document_type: 'import_goods', taxable_value: 8000, igst_amount: 1440, cgst_amount: 0 });
    expect(byNumber('INMAA/EXLBOER')).toMatchObject({ document_type: 'import_goods', original_invoice_number: 'EXLBOEO', igst_amount: 180 });
    expect(byNumber('INSEZ/EXLSEZ')).toMatchObject({ supplier_gstin: SUPPLIER, document_type: 'import_goods', igst_amount: 360 });
  });

  it('rejects a GSTR-1 style workbook, a sheet with missing columns, and bad rows without returning documents', async () => {
    const gstr1 = await workbook((book) => {
      const sheet = book.addWorksheet('b2b');
      sheet.addRow(['GSTIN/UIN of Recipient', 'Invoice number', 'Invoice date', 'Invoice value', 'Taxable Value', 'Integrated Tax']);
      sheet.addRow(['29AAAAA0000A1Z5', 'INV-1', '01-11-2026', 100, 100, 18]);
    });
    const wrong = await parseGstr2bExcel(gstr1);
    expect(wrong.ok).toBe(false);
    expect(wrong.errors[0].message).toMatch(/GSTR-1/);
    expect(wrong.rows).toEqual([]);

    const missing = await workbook((book) => {
      const sheet = book.addWorksheet('B2B');
      meta(sheet);
      sheet.addRow(['GSTIN of supplier', 'Invoice number', 'Invoice Date']);
      sheet.addRow([SUPPLIER, 'EXL-1', '15-11-2026']);
    });
    const missingParsed = await parseGstr2bExcel(missing);
    expect(missingParsed.ok).toBe(false);
    expect(missingParsed.errors[0].message).toMatch(/Missing columns/);
    expect(missingParsed.rows).toEqual([]);

    const bad = await workbook((book) => {
      const sheet = book.addWorksheet('B2B');
      meta(sheet);
      sheet.addRow(['GSTIN of supplier', 'Invoice number', 'Invoice Date', 'Taxable Value', 'Integrated Tax', 'Central Tax', 'State/UT Tax', 'Cess', 'ITC Availability']);
      sheet.addRow(['NOTGSTIN', 'EXL-BAD', '15-11-2026', 100, 0, 9, 9, 0, 'Yes']);
      sheet.addRow([SUPPLIER, '', '15-11-2026', 100, 0, 9, 9, 0, 'Yes']);
      sheet.addRow([SUPPLIER, 'EXL-DATE', '32-13-2026', 100, 0, 9, 9, 0, 'Yes']);
      sheet.addRow([SUPPLIER, 'EXL-NUM', '15-11-2026', 'abc', 0, 9, 9, 0, 'Yes']);
      sheet.addRow([SUPPLIER, 'EXL-OK', '15-11-2026', 10, 0, 0, 0, 0, 'Yes']);
    });
    const badParsed = await parseGstr2bExcel(bad);
    expect(badParsed.ok).toBe(false);
    expect(badParsed.rows).toEqual([]);
    expect(badParsed.errors.map((error) => error.message).join(' ')).toMatch(/GSTIN/);
    expect(badParsed.errors.map((error) => error.message).join(' ')).toMatch(/Document number is missing/);
    expect(badParsed.errors.map((error) => error.message).join(' ')).toMatch(/not a date/);
    expect(badParsed.errors.map((error) => error.message).join(' ')).toMatch(/not a number/);

    const notExcel = await parseGstr2bExcel(Buffer.from('this is not a workbook'));
    expect(notExcel.ok).toBe(false);
  });

  it('matches the normalized JSON for the same statement', async () => {
    const json = {
      data: {
        gstin: GSTIN,
        rtnprd: '112026',
        docdata: {
          b2b: [{
            ctin: SUPPLIER,
            trdnm: 'Supplier',
            inv: [{ inum: 'EXL-01', dt: '15-11-2026', pos: '29', rev: 'N', itcavl: 'Y', txval: 1000, igst: 0, cgst: 90, sgst: 90, cess: 0 }],
          }],
          b2ba: [{
            ctin: SUPPLIER,
            inv: [{ inum: 'EXL-14R', dt: '15-11-2026', oinum: 'EXL-14O', oidt: '01-10-2026', txval: 700, igst: 0, cgst: 63, sgst: 63, cess: 0, itcavl: 'Y' }],
          }],
          cdnr: [{
            ctin: SUPPLIER,
            nt: [
              { ntnum: 'EXL-CN', typ: 'C', dt: '15-11-2026', itcavl: 'Y', txval: 500, igst: 0, cgst: 45, sgst: 45, cess: 0 },
              { ntnum: 'EXL-DN', typ: 'D', dt: '15-11-2026', itcavl: 'Y', txval: 400, igst: 0, cgst: 36, sgst: 36, cess: 0 },
            ],
          }],
          isd: [{ ctin: SUPPLIER, doclist: [{ docnum: 'EXL-ISD', docdt: '15-11-2026', itcelg: 'Y', igst: 0, cgst: 18, sgst: 18, cess: 0 }] }],
          impg: [{ portcode: 'INMAA', boenum: 'EXLBOE', boedt: '15-11-2026', txval: 8000, igst: 1440, cess: 0 }],
        },
      },
    };
    const bytes = await workbook((book) => {
      const b2b = book.addWorksheet('B2B');
      meta(b2b);
      b2b.addRow(['GSTIN of supplier', 'Invoice number', 'Invoice Date', 'Place of supply', 'Supply Attract Reverse Charge', 'Taxable Value', 'Integrated Tax', 'Central Tax', 'State/UT Tax', 'Cess', 'ITC Availability']);
      b2b.addRow([SUPPLIER, 'EXL-01', '15-11-2026', '29', 'No', 1000, 0, 90, 90, 0, 'Yes']);
      const b2ba = book.addWorksheet('B2BA');
      meta(b2ba);
      b2ba.addRow(['GSTIN of supplier', 'Invoice number', 'Invoice Date', 'Original Invoice number', 'Original Invoice Date', 'Taxable Value', 'Integrated Tax', 'Central Tax', 'State/UT Tax', 'Cess', 'ITC Availability']);
      b2ba.addRow([SUPPLIER, 'EXL-14R', '15-11-2026', 'EXL-14O', '01-10-2026', 700, 0, 63, 63, 0, 'Yes']);
      const cdnr = book.addWorksheet('B2B-CDNR');
      meta(cdnr);
      cdnr.addRow(['GSTIN of supplier', 'Note number', 'Note type', 'Note date', 'Taxable Value', 'Integrated Tax', 'Central Tax', 'State/UT Tax', 'Cess', 'ITC Availability']);
      cdnr.addRow([SUPPLIER, 'EXL-CN', 'C', '15-11-2026', 500, 0, 45, 45, 0, 'Yes']);
      cdnr.addRow([SUPPLIER, 'EXL-DN', 'D', '15-11-2026', 400, 0, 36, 36, 0, 'Yes']);
      const isd = book.addWorksheet('ISD');
      meta(isd);
      isd.addRow(['GSTIN of supplier', 'ISD Document number', 'ISD Document date', 'Integrated Tax', 'Central Tax', 'State/UT Tax', 'Cess', 'ITC Availability']);
      isd.addRow([SUPPLIER, 'EXL-ISD', '15-11-2026', 0, 18, 18, 0, 'Yes']);
      const impg = book.addWorksheet('IMPG');
      meta(impg);
      impg.addRow(['Port code', 'Bill of Entry number', 'Bill of Entry date', 'Taxable Value', 'Integrated Tax', 'Cess']);
      impg.addRow(['INMAA', 'EXLBOE', '15-11-2026', 8000, 1440, 0]);
    });
    const excel = await parseGstr2bExcel(bytes);
    const jsonRows = parseGstr2bJson(json).rows;
    const shape = (rows: typeof jsonRows) => rows
      .map((row) => ({
        supplier_gstin: row.supplier_gstin,
        invoice_number: row.invoice_number,
        invoice_date: row.invoice_date,
        document_type: row.document_type,
        taxable_value: row.taxable_value,
        igst_amount: row.igst_amount,
        cgst_amount: row.cgst_amount,
        sgst_amount: row.sgst_amount,
        cess_amount: row.cess_amount,
        itc_eligibility: row.itc_eligibility,
        reverse_charge: row.reverse_charge,
        original_invoice_number: row.original_invoice_number,
        original_invoice_date: row.original_invoice_date,
      }))
      .sort((a, b) => `${a.document_type}${a.invoice_number}`.localeCompare(`${b.document_type}${b.invoice_number}`));
    expect(excel.ok).toBe(true);
    expect(shape(excel.rows)).toEqual(shape(jsonRows));
  });
});
