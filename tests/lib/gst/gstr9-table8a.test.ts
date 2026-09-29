import { aggregateTable8AFromPortal, table8APeriods, type Gstr2bTable8ARow } from '@/lib/gst/gstr9-table8a';

const row = (o: Partial<Gstr2bTable8ARow>): Gstr2bTable8ARow => ({
  filing_period: '2026-05',
  supplier_gstin: '27ABCDE1234F1Z5',
  invoice_number: 'INV-1',
  invoice_date: '2026-05-10',
  document_type: 'invoice',
  taxable_value: 1000,
  igst_amount: 0,
  cgst_amount: 90,
  sgst_amount: 90,
  cess_amount: 0,
  itc_eligibility: 'eligible',
  reverse_charge: 'N',
  original_invoice_number: null,
  original_invoice_date: null,
  ...o,
});

describe('table8APeriods', () => {
  test('FY months run April to March; 2B periods extend to October of the next FY', () => {
    const { fyMonths, portalPeriods } = table8APeriods(2026);
    expect(fyMonths).toEqual([
      '2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09',
      '2026-10', '2026-11', '2026-12', '2027-01', '2027-02', '2027-03',
    ]);
    expect(portalPeriods.slice(12)).toEqual(['2027-04', '2027-05', '2027-06', '2027-07', '2027-08', '2027-09', '2027-10']);
  });
});

describe('aggregateTable8AFromPortal', () => {
  test('keeps IGST, CGST, SGST and cess in their own heads', () => {
    const a = aggregateTable8AFromPortal(
      [
        row({}),
        row({ invoice_number: 'INV-2', supplier_gstin: '29ABCDE1234F1Z5', igst_amount: 360, cgst_amount: 0, sgst_amount: 0, taxable_value: 2000, cess_amount: 12 }),
      ],
      2026
    );
    expect(a).toEqual({ taxable_value: 3000, igst: 360, cgst: 90, sgst: 90, cess: 12 });
  });

  test('debit notes add, credit notes subtract', () => {
    const a = aggregateTable8AFromPortal(
      [
        row({}),
        row({ invoice_number: 'DN-1', document_type: 'debit_note', taxable_value: 100, cgst_amount: 9, sgst_amount: 9 }),
        row({ invoice_number: 'CN-1', document_type: 'credit_note', taxable_value: 300, cgst_amount: 27, sgst_amount: 27 }),
      ],
      2026
    );
    expect(a).toEqual({ taxable_value: 800, igst: 0, cgst: 72, sgst: 72, cess: 0 });
  });

  test('excludes reverse charge, ITC not available, imports and ISD', () => {
    const a = aggregateTable8AFromPortal(
      [
        row({}),
        row({ invoice_number: 'RCM-1', reverse_charge: 'Y' }),
        row({ invoice_number: 'NA-1', itc_eligibility: 'ineligible' }),
        row({ invoice_number: 'BOE-1', document_type: 'import_goods', igst_amount: 500, cgst_amount: 0, sgst_amount: 0 }),
        row({ invoice_number: 'ISD-1', document_type: 'isd' }),
      ],
      2026
    );
    expect(a).toEqual({ taxable_value: 1000, igst: 0, cgst: 90, sgst: 90, cess: 0 });
  });

  test('counts documents dated in the FY, including late 2B periods, and drops prior-FY documents', () => {
    const a = aggregateTable8AFromPortal(
      [
        row({ invoice_number: 'MAR', invoice_date: '2027-03-28', filing_period: '2027-06' }),
        row({ invoice_number: 'OLD', invoice_date: '2026-03-30', filing_period: '2026-04' }),
        row({ invoice_number: 'NEXT', invoice_date: '2027-04-02', filing_period: '2027-04' }),
      ],
      2026
    );
    expect(a).toEqual({ taxable_value: 1000, igst: 0, cgst: 90, sgst: 90, cess: 0 });
  });

  test('an amended document replaces the original instead of adding to it', () => {
    const a = aggregateTable8AFromPortal(
      [
        row({ filing_period: '2026-05', invoice_number: 'INV-9', invoice_date: '2026-05-10' }),
        row({
          filing_period: '2026-07',
          invoice_number: 'INV-9A',
          invoice_date: '2026-05-10',
          taxable_value: 1200,
          cgst_amount: 108,
          sgst_amount: 108,
          original_invoice_number: 'INV-9',
          original_invoice_date: '2026-05-10',
        }),
      ],
      2026
    );
    expect(a).toEqual({ taxable_value: 1200, igst: 0, cgst: 108, sgst: 108, cess: 0 });
  });

  test('an amendment that moves a document out of the FY removes it', () => {
    const a = aggregateTable8AFromPortal(
      [
        row({ filing_period: '2026-05', invoice_number: 'INV-7', invoice_date: '2026-05-10' }),
        row({
          filing_period: '2027-05',
          invoice_number: 'INV-7',
          invoice_date: '2027-04-15',
          original_invoice_number: 'INV-7',
          original_invoice_date: '2026-05-10',
        }),
      ],
      2026
    );
    expect(a).toEqual({ taxable_value: 0, igst: 0, cgst: 0, sgst: 0, cess: 0 });
  });
});
